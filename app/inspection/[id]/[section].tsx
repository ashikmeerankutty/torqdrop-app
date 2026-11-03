import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { useCapture } from '@/components/camera/CameraProvider';
import { GuideSheet } from '@/components/inspection/GuideSheet';
import { ScanSheet } from '@/components/inspection/ScanSheet';
import { ItemCard } from '@/components/inspection/ItemCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { space } from '@/constants/Theme';
import { getGuide, SECTION_GUIDES } from '@/lib/diagnostics/checklists/guides';
import type { ScannedAnswer } from '@/lib/diagnostics/document-fields';
import { formatValue } from '@/lib/diagnostics/evidence-engine';
import { getSection, PPI_V1 } from '@/lib/diagnostics/checklists/ppi-v1';
import { type ItemRecord, sectionProgress } from '@/lib/diagnostics/checklists/types';
import { useSession } from '@/lib/auth/session';
import { analyzeSectionPhotos } from '@/lib/firebase/ai';
import {
  addObdEvidence,
  addPhotoEvidence,
  type Finding,
  type InspectionSummary,
  type ObdEvidence,
  type PhotoEvidence,
  saveItem,
  saveItems,
  type SectionDoc,
  setFindingVerification,
  subscribeInspection,
  subscribeSectionEvidence,
  subscribeSectionFindings,
  subscribeSections,
} from '@/lib/firebase/inspections';
import { needsAiCheck } from '@/lib/firebase/photo-ai';
import { enqueuePhoto, preparePhoto } from '@/lib/firebase/upload-queue';
import { useDocumentScan } from '@/lib/firebase/use-document-scan';
import type { DocumentKind } from '@/lib/schemas/document';
import { readCodes, useObd } from '@/lib/obd/connection';
import { readEcuExtended } from '@/lib/obd/inspection-snapshot';

export default function SectionScreen() {
  const { id, section: sectionKey } = useLocalSearchParams<{ id: string; section: string }>();
  const section = getSection(sectionKey);
  const { user } = useSession();
  const capture = useCapture();
  const { colors } = useTheme();
  const [doc, setDoc] = useState<SectionDoc | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [photos, setPhotos] = useState<PhotoEvidence[]>([]);
  const [obdReads, setObdReads] = useState<ObdEvidence[]>([]);
  const obdConnected = useObd().status === 'connected';
  const [findings, setFindings] = useState<Finding[]>([]);
  const inspection = useRef<InspectionSummary | null>(null);
  // Every section, so a scanned RC can fill answers in Vehicle details from the Documents screen.
  const [allSections, setAllSections] = useState<Record<string, SectionDoc>>({});
  const [carRegNo, setCarRegNo] = useState<string | undefined>();
  const scan = useDocumentScan();
  const scanKinds = SCANNABLE[sectionKey] ?? [];

  useEffect(
    () =>
      subscribeSections(id, (all) => {
        setAllSections(all);
        setDoc(all[sectionKey]);
        setLoaded(true);
      }),
    [id, sectionKey],
  );
  useEffect(
    () =>
      subscribeSectionEvidence(id, sectionKey, (e) => {
        setPhotos(e.photos);
        setObdReads(e.obd);
      }),
    [id, sectionKey],
  );
  const [locked, setLocked] = useState(false);
  const [guideKey, setGuideKey] = useState<string | null>(null);
  useEffect(
    () =>
      subscribeInspection(id, (i) => {
        inspection.current = i;
        setLocked(i?.status === 'complete');
        setCarRegNo(i?.vehicle.regNo);
      }),
    [id],
  );
  useEffect(() => subscribeSectionFindings(id, sectionKey, setFindings), [id, sectionKey]);

  // Callbacks read the latest section through a ref so ItemCard stays memoised.
  const items = useRef<Record<string, ItemRecord>>({});
  useEffect(() => {
    items.current = doc?.items ?? {};
  }, [doc]);

  const onSave = useCallback(
    (itemKey: string, record: Omit<ItemRecord, 'evidenceIds'>) =>
      saveItem(id, sectionKey, itemKey, record, items.current, inspection.current?.status ?? 'in_progress'),
    [id, sectionKey],
  );

  const onAddPhoto = useCallback(
    async (itemKey: string) => {
      if (!user) return;
      const def = section?.items.find((i) => i.key === itemKey);
      const shot = await capture({ title: def?.label, hint: getGuide(sectionKey, itemKey)?.capture });
      if (!shot) return;
      try {
        const photo = await preparePhoto(shot.uri, shot.width, shot.height);
        const { evidenceId, storagePath } = addPhotoEvidence(user.uid, id, sectionKey, itemKey, {
          width: photo.width,
          height: photo.height,
        });
        await enqueuePhoto({ evidenceId, inspectionId: id, storagePath }, photo.uri);
      } catch (e) {
        console.warn('[section] photo failed', e);
        Alert.alert('Photo not saved', 'Something went wrong saving the photo. Try again.');
      }
    },
    [user, id, sectionKey, section, capture],
  );

  // ECU scan: read stored and pending codes, answer the check from them, and keep the raw read as evidence.
  const onReadObd = useCallback(
    async (itemKey: string) => {
      const def = section?.items.find((i) => i.key === itemKey);
      if (!def || def.input.kind !== 'choice') return;
      try {
        const { dtcs, mil, simulated, protocol } = await readCodes();
        // VIN, readiness and "codes cleared recently" go with the codes; a car that can't answer just leaves them out.
        const extended = await readEcuExtended().catch(() => null);
        const label = dtcs.stored.length ? 'Stored codes' : dtcs.pending.length ? 'Pending codes' : 'No codes';
        const option = def.input.options.find((o) => o.label === label);
        if (!option) return;
        addObdEvidence(id, sectionKey, itemKey, { ...dtcs, milOn: mil?.milOn ?? null, protocol, simulated, extended });
        const current = items.current[itemKey];
        saveItem(
          id,
          sectionKey,
          itemKey,
          { status: option.rating, label: def.label, value: label, ...(current?.remarks ? { remarks: current.remarks } : {}) },
          items.current,
          inspection.current?.status ?? 'in_progress',
        );
      } catch (e) {
        Alert.alert('Could not read codes', e instanceof Error ? e.message : 'Try again.');
      }
    },
    [id, sectionKey, section],
  );

  // The AI check runs once the inspector leaves the section: every photo not yet checked goes in one
  // call. Photos still uploading are picked up by the server when their upload finishes.
  const unchecked = useRef(false);
  useEffect(() => {
    unchecked.current = photos.some((p) => p.uploadState === 'pending' || needsAiCheck(p));
  }, [photos]);
  useEffect(
    () => () => {
      if (!unchecked.current || inspection.current?.status === 'complete') return;
      analyzeSectionPhotos(id, sectionKey).catch((e) => console.warn('[section] AI check failed', e));
    },
    [id, sectionKey],
  );

  const onVerify = useCallback(
    (findingId: string, status: 'confirmed' | 'dismissed') => setFindingVerification(id, findingId, status),
    [id],
  );

  const findingsByItem = useMemo(() => {
    const map: Record<string, Finding[]> = {};
    for (const f of findings) (map[f.itemKey] ??= []).push(f);
    for (const list of Object.values(map)) list.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    return map;
  }, [findings]);

  const latestObd = useMemo(() => {
    const map: Record<string, ObdEvidence> = {};
    for (const r of obdReads) {
      const prev = map[r.itemKey];
      if (!prev || (r.capturedAt?.getTime() ?? Infinity) > (prev.capturedAt?.getTime() ?? Infinity)) map[r.itemKey] = r;
    }
    return map;
  }, [obdReads]);

  const photosByItem = useMemo(() => {
    const map: Record<string, PhotoEvidence[]> = {};
    for (const p of photos) (map[p.itemKey] ??= []).push(p);
    for (const list of Object.values(map)) list.sort((a, b) => (a.capturedAt?.getTime() ?? 0) - (b.capturedAt?.getTime() ?? 0));
    return map;
  }, [photos]);

  /** Saves the ticked answers section by section, and files the document photo as evidence. */
  function applyScan(answers: ScannedAnswer[]) {
    const scanned = scan.current();
    scan.close();
    if (!scanned || !user) return;
    const status = inspection.current?.status ?? 'in_progress';
    const bySection = new Map<string, ScannedAnswer[]>();
    for (const a of answers) bySection.set(a.sectionKey, [...(bySection.get(a.sectionKey) ?? []), a]);
    for (const [key, list] of bySection) {
      const records = Object.fromEntries(list.map((a) => [a.itemKey, a.record]));
      saveItems(id, key, records, allSections[key]?.items ?? {}, status);
    }
    const itemKey = scanned.scan.kind === 'rc' ? 'rc' : 'insurance';
    const { photo } = scanned;
    const { evidenceId, storagePath } = addPhotoEvidence(user.uid, id, 'documents', itemKey, { width: photo.width, height: photo.height });
    enqueuePhoto({ evidenceId, inspectionId: id, storagePath }, photo.uri).catch((e) => console.warn('[section] scan photo failed', e));
  }

  if (!section || !loaded) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        {section ? <ActivityIndicator color={colors.primary} /> : <Text>Unknown section.</Text>}
      </View>
    );
  }

  const progress = sectionProgress(section, doc?.items ?? {});
  const index = PPI_V1.sections.indexOf(section);
  const nextSection = PPI_V1.sections[index + 1];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: section.title }} />
      <View style={[styles.progress, { borderBottomColor: colors.border }]}>
        <View style={styles.progressRow}>
          <Text variant="caption" tone="textMuted">
            Section {index + 1} of {PPI_V1.sections.length}
          </Text>
          <Text variant="caption" tone={progress.answered === progress.total ? 'primary' : 'textMuted'} style={styles.count}>
            {progress.answered}/{progress.total} answered
            {progress.openCritical.length ? ` · ${progress.openCritical.length} critical left` : ''}
          </Text>
        </View>
        <ProgressBar value={progress.total ? progress.answered / progress.total : 0} height={4} />
        {SECTION_GUIDES[section.key] && (
          <Pressable onPress={() => setGuideKey(SECTION_KEY)} hitSlop={6} style={styles.guideLink} accessibilityRole="button">
            <Icon name="info" size={16} tone="tint" />
            <Text variant="caption" tone="tint" style={styles.guideLinkText}>
              How to inspect {section.title.toLowerCase()}
            </Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={section.items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        ListHeaderComponent={
          locked ? (
            <Banner tone="success" icon="shield" title="Signed off">
              This inspection is locked. Answers can be viewed but not changed.
            </Banner>
          ) : scanKinds.length ? (
            <View style={styles.scanRow}>
              {scanKinds.map((k) => (
                <Button
                  key={k}
                  title={k === 'rc' ? 'Scan RC' : 'Scan insurance'}
                  icon="camera"
                  variant="secondary"
                  onPress={() => scan.start(k)}
                  style={styles.grow}
                />
              ))}
            </View>
          ) : undefined
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {nextSection ? (
              <Button
                title={`Next: ${nextSection.title}`}
                icon="forward"
                size="lg"
                variant={progress.answered === progress.total ? 'primary' : 'secondary'}
                onPress={() => router.replace(`/inspection/${id}/${nextSection.key}`)}
              />
            ) : (
              <Button title="Back to overview" size="lg" onPress={() => router.back()} />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={locked ? styles.locked : undefined}>
            <ItemCard
              item={item}
              record={doc?.items?.[item.key]}
              photos={photosByItem[item.key] ?? EMPTY}
              onSave={onSave}
              onAddPhoto={onAddPhoto}
              obd={item.key === 'ecu_scan' ? { connected: obdConnected, reading: latestObd[item.key], onRead: onReadObd } : undefined}
              ai={{ findings: findingsByItem[item.key] ?? EMPTY_FINDINGS, onVerify }}
              onShowGuide={setGuideKey}
            />
          </View>
        )}
      />
      <ScanSheet
        state={scan.state}
        current={currentAnswers(allSections)}
        carRegNo={carRegNo}
        onApply={applyScan}
        onRetake={scan.retake}
        onClose={scan.close}
      />
      <GuideSheet
        guide={
          guideKey === SECTION_KEY
            ? { title: section.title, guide: SECTION_GUIDES[section.key] }
            : guideKey
              ? guideFor(section.key, guideKey, section.items.find((i) => i.key === guideKey)?.label ?? '')
              : null
        }
        onClose={() => setGuideKey(null)}
      />
    </View>
  );
}

/** Sections that can be filled from a scanned document, and which documents. */
const SCANNABLE: Record<string, DocumentKind[]> = { vehicle_details: ['rc'], documents: ['rc', 'insurance'] };

/** Display text of every answer, by "section/item", for the scan sheet's "replaces" notes. */
function currentAnswers(sections: Record<string, SectionDoc>) {
  const out: Record<string, string | undefined> = {};
  for (const [sectionKey, doc] of Object.entries(sections)) {
    const def = getSection(sectionKey);
    for (const [itemKey, record] of Object.entries(doc.items ?? {})) {
      const item = def?.items.find((i) => i.key === itemKey);
      if (item && record.status) out[`${sectionKey}/${itemKey}`] = formatValue(item, record) ?? undefined;
    }
  }
  return out;
}

/** Guide-sheet key for the section's own guide, distinct from any item key. */
const SECTION_KEY = '__section__';

function guideFor(sectionKey: string, itemKey: string, title: string) {
  const guide = getGuide(sectionKey, itemKey);
  return guide ? { title, guide, itemKey } : null;
}

const EMPTY: PhotoEvidence[] = [];
const EMPTY_FINDINGS: Finding[] = [];

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  progress: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  scanRow: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
  guideLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingTop: 2 },
  guideLinkText: { fontWeight: '600' },
  count: { fontVariant: ['tabular-nums'] },
  container: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  footer: { marginTop: space.md },
  // Signed-off inspections are read-only. The rules reject writes anyway; this stops taps that look like they worked.
  locked: { pointerEvents: 'none' },
});
