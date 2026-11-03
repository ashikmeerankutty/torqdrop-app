import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import {
  type ItemDef,
  type ItemRecord,
  type ItemStatus,
  type ItemValue,
  type PanelValue,
  PAINT_OPTIONS,
  rateValue,
  STRUCTURE_OPTIONS,
  treadPercent,
} from '@/lib/diagnostics/checklists/types';
import type { Finding, ObdEvidence, PhotoEvidence } from '@/lib/firebase/inspections';

import { Chip } from './Chip';
import { FindingCard } from './FindingCard';
import { PhotoThumb } from './PhotoThumb';
import { needsAiCheck } from '@/lib/firebase/photo-ai';

import { STATUS_COLOR } from './status';

interface Props {
  item: ItemDef;
  record?: ItemRecord;
  photos: PhotoEvidence[];
  onSave: (itemKey: string, record: Omit<ItemRecord, 'evidenceIds'>) => void;
  onAddPhoto: (itemKey: string) => void;
  /** For OBD-linked checks that can be answered from the car (ECU scan). */
  obd?: { connected: boolean; reading?: ObdEvidence; onRead: (itemKey: string) => void };
  /** Findings from the AI photo check, which runs when the inspector leaves the section. */
  ai?: {
    findings: Finding[];
    onVerify: (findingId: string, status: 'confirmed' | 'dismissed') => void;
  };
  /** Opens the what-to-check guide for this item. */
  onShowGuide?: (itemKey: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

function ItemCardImpl({ item, record, photos, onSave, onAddPhoto, obd, ai, onShowGuide }: Props) {
  const { input } = item;
  const { colors } = useTheme();

  const [draft, setDraft] = useState(
    typeof record?.value === 'string' || typeof record?.value === 'number' ? String(record.value) : '',
  );
  const [panel, setPanel] = useState<PanelValue>(typeof record?.value === 'object' ? record.value : {});
  const [remarks, setRemarks] = useState(record?.remarks ?? '');
  const [showRemarks, setShowRemarks] = useState(!!record?.remarks);
  const [reason, setReason] = useState(record?.notInspectedReason ?? '');
  const [askReason, setAskReason] = useState(record?.status === 'not_inspected');

  const unit = input.kind === 'number' ? input.unit : input.kind === 'tread' ? 'mm' : undefined;
  const status = record?.status;

  function save(next: { status: ItemStatus; value?: ItemValue; notInspectedReason?: string }) {
    onSave(item.key, {
      label: item.label,
      ...next,
      ...(next.value !== undefined && unit ? { unit } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    });
  }

  function answer(value: ItemValue) {
    const rating = rateValue(input, value, today());
    if (rating) {
      setAskReason(false);
      save({ status: rating, value });
    }
  }

  // Typed fields save on blur, which doesn't always fire when the screen is left with the keyboard
  // open. Anything still unsaved is flushed when the card unmounts.
  const dirty = useRef(new Set<'draft' | 'reason' | 'remarks'>());
  const flush = useRef(() => {});
  useEffect(() => {
    flush.current = () => {
      if (dirty.current.has('draft')) commitDraft();
      if (dirty.current.has('reason') && askReason) commitReason();
      if (dirty.current.has('remarks')) commitRemarks();
    };
  });
  useEffect(() => () => flush.current(), []);

  function commitDraft() {
    dirty.current.delete('draft');
    const raw = draft.trim();
    if (!raw) return;
    answer(input.kind === 'number' || input.kind === 'tread' ? Number(raw.replace(',', '.')) : raw);
  }

  function commitReason() {
    dirty.current.delete('reason');
    if (reason.trim()) save({ status: 'not_inspected', notInspectedReason: reason.trim() });
  }

  function commitRemarks() {
    dirty.current.delete('remarks');
    // Remarks ride along with the current answer; before an answer they're sent with it.
    if (record?.status) {
      onSave(item.key, { ...record, remarks: remarks.trim() || undefined });
    }
  }

  const checking = photos.some((p) => p.aiAnalysis?.status === 'running');
  const waiting = photos.some((p) => p.uploadState === 'pending' || needsAiCheck(p));
  const nothingNotable = photos.some(
    (p) => p.aiAnalysis?.status === 'ok' && p.aiAnalysis.imageUsable && !p.aiAnalysis.findingIds?.length,
  );
  const uploading = photos.some((p) => p.uploadState === 'pending');
  const unusable = photos.find((p) => p.aiAnalysis?.imageUsable === false);
  const needsPhoto = item.photo && photos.length === 0 && status && status !== 'not_applicable' && status !== 'not_inspected';

  return (
    <Card accent={status ? STATUS_COLOR[status] : undefined} style={styles.card}>
      <RNView style={styles.header}>
        <RNView style={styles.titleWrap}>
          <Text variant="bodyStrong" style={styles.label}>
            {item.label}
          </Text>
          {item.critical && <Pill label="Critical" color={STATUS_COLOR.defect} />}
        </RNView>
        {onShowGuide && (
          <Pressable
            onPress={() => onShowGuide(item.key)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`How to check ${item.label}`}>
            <Icon name="info" size={20} tone="tint" />
          </Pressable>
        )}
        {status && <Icon name="check" size={20} color={STATUS_COLOR[status]} />}
      </RNView>

      {obd && (
        <RNView style={styles.obd}>
          {obd.connected ? (
            <Button title="Read codes from car" icon="bluetooth" variant="secondary" onPress={() => obd.onRead(item.key)} />
          ) : (
            <Text variant="caption" tone="textMuted">
              Connect an OBD adapter on the Drive tab to read codes from the car.
            </Text>
          )}
          {obd.reading && <ObdReadingLine reading={obd.reading} />}
        </RNView>
      )}

      {input.kind === 'choice' && (
        <RNView style={styles.row}>
          {input.options.map((o) => (
            <Chip
              key={o.label}
              label={o.label}
              large
              color={STATUS_COLOR[o.rating]}
              selected={record?.value === o.label && status === o.rating}
              onPress={() => answer(o.label)}
            />
          ))}
        </RNView>
      )}

      {input.kind === 'panel' &&
        ([
          ['Paint', 'paint', PAINT_OPTIONS],
          ['Structure', 'structure', STRUCTURE_OPTIONS],
        ] as const).map(([title, field, options]) => (
          <RNView key={field} style={styles.panelRow}>
            <Text variant="caption" tone="textMuted">
              {title}
            </Text>
            <RNView style={styles.row}>
              {options.map((o) => (
                <Chip
                  key={o.label}
                  label={o.label}
                  large
                  color={STATUS_COLOR[o.rating]}
                  selected={panel[field] === o.label}
                  onPress={() => {
                    const next = { ...panel, [field]: o.label };
                    setPanel(next);
                    answer(next);
                  }}
                />
              ))}
            </RNView>
          </RNView>
        ))}

      {(input.kind === 'text' || input.kind === 'number' || input.kind === 'date' || input.kind === 'tread') && (
        <TextField
          value={draft}
          onChangeText={(v) => {
            dirty.current.add('draft');
            setDraft(v);
          }}
          onEndEditing={commitDraft}
          onSubmitEditing={commitDraft}
          placeholder={input.kind === 'date' ? 'YYYY-MM-DD' : input.kind === 'text' ? input.placeholder : unit}
          keyboardType={input.kind === 'number' || input.kind === 'tread' ? 'decimal-pad' : 'default'}
          autoCapitalize={item.key === 'reg_no' ? 'characters' : 'sentences'}
          returnKeyType="done"
          suffix={unit}
        />
      )}
      {input.kind === 'tread' && typeof record?.value === 'number' && (
        <Text variant="caption" tone="textMuted">
          {treadPercent(record.value)}% usable tread left
        </Text>
      )}

      <RNView style={styles.row}>
        <Chip
          label="N/A"
          color={STATUS_COLOR.not_applicable}
          selected={status === 'not_applicable'}
          onPress={() => {
            setAskReason(false);
            save({ status: 'not_applicable' });
          }}
        />
        <Chip
          label="Not inspected"
          color={STATUS_COLOR.not_inspected}
          selected={status === 'not_inspected' || askReason}
          onPress={() => {
            setAskReason(true);
            commitReason();
          }}
        />
        {!showRemarks && (
          <Pressable onPress={() => setShowRemarks(true)} style={styles.link} hitSlop={8}>
            <Text variant="caption" tone="tint" style={styles.linkText}>
              + Remarks
            </Text>
          </Pressable>
        )}
      </RNView>

      {askReason && (
        <TextField
          value={reason}
          onChangeText={(v) => {
            dirty.current.add('reason');
            setReason(v);
          }}
          onEndEditing={commitReason}
          onSubmitEditing={commitReason}
          placeholder="Why wasn't this inspected? (required)"
          autoFocus={!reason}
        />
      )}

      {showRemarks && (
        <TextField
          value={remarks}
          onChangeText={(v) => {
            dirty.current.add('remarks');
            setRemarks(v);
          }}
          onEndEditing={commitRemarks}
          placeholder="Remarks"
          multiline
        />
      )}

      {(item.photo || photos.length > 0) && (
        <RNView style={styles.row}>
          {photos.map((p) => (
            <PhotoThumb key={p.id} photo={p} />
          ))}
          <Pressable
            onPress={() => onAddPhoto(item.key)}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            style={({ pressed }) => [
              styles.addPhoto,
              {
                borderColor: needsPhoto ? STATUS_COLOR.attention : colors.border,
                backgroundColor: pressed ? colors.surfaceRaised : colors.background,
              },
            ]}>
            <Icon name="camera" size={22} color={needsPhoto ? STATUS_COLOR.attention : colors.textMuted} />
            <Text variant="caption" style={[styles.addPhotoText, { color: needsPhoto ? STATUS_COLOR.attention : colors.textMuted }]}>
              {needsPhoto ? 'Needed' : 'Add'}
            </Text>
          </Pressable>
        </RNView>
      )}

      {ai && (photos.length > 0 || ai.findings.length > 0) && (
        <RNView style={styles.ai}>
          {checking ? (
            <RNView style={styles.row}>
              <ActivityIndicator color={colors.primary} />
              <Text variant="caption" tone="textMuted">
                AI is checking {photos.length === 1 ? 'the photo' : 'the photos'}…
              </Text>
            </RNView>
          ) : waiting ? (
            <RNView style={styles.row}>
              <Icon name="ai" size={14} tone="textMuted" />
              <Text variant="caption" tone="textMuted" style={styles.grow}>
                {uploading ? 'Uploading. ' : ''}AI checks the photos when you leave this section.
              </Text>
            </RNView>
          ) : null}
          {unusable && !ai.findings.length && (
            <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
              {"AI couldn't use the photo"}
              {unusable.aiAnalysis?.unusableReason ? `: ${unusable.aiAnalysis.unusableReason}` : ''}. Try another shot.
            </Text>
          )}
          {nothingNotable && !ai.findings.length && (
            <Text variant="caption" tone="textMuted">
              AI saw nothing notable in the photo. That is not proof there is no problem.
            </Text>
          )}
          {ai.findings.map((f) => (
            <FindingCard key={f.id} finding={f} onVerify={(status) => ai.onVerify(f.id, status)} />
          ))}
        </RNView>
      )}
    </Card>
  );
}

function ObdReadingLine({ reading }: { reading: ObdEvidence }) {
  const { stored, pending, simulated, extended } = reading.payload;
  const codes = [
    stored.length ? `Stored ${stored.join(', ')}` : null,
    pending.length ? `Pending ${pending.join(', ')}` : null,
  ].filter(Boolean);
  const incomplete = extended?.monitors.filter((m) => !m.complete).length ?? 0;
  const facts = extended
    ? [
        extended.vin ? `VIN ${extended.vin}` : null,
        extended.distanceSinceClearKm != null ? `${Math.round(extended.distanceSinceClearKm)} km since codes cleared` : null,
        extended.monitors.length ? (incomplete ? `${incomplete} self-tests not finished` : 'all self-tests complete') : null,
        extended.odometerKm != null ? `ECU odometer ${Math.round(extended.odometerKm).toLocaleString('en-IN')} km` : null,
      ].filter(Boolean)
    : [];
  return (
    <>
      <Text variant="caption" tone="textMuted">
        {simulated ? 'SIMULATED · ' : ''}
        Read {reading.capturedAt?.toLocaleTimeString() ?? 'just now'}: {codes.length ? codes.join(' · ') : 'no codes'}
      </Text>
      {facts.length > 0 && (
        <Text variant="caption" tone="textMuted">
          {facts.join(' · ')}
        </Text>
      )}
      {extended?.flags.map((f) => (
        <Text key={f.id} variant="caption" style={{ color: STATUS_COLOR.attention, fontWeight: '600' }}>
          {f.title}
        </Text>
      ))}
    </>
  );
}

export const ItemCard = memo(ItemCardImpl);

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  titleWrap: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  label: { flexShrink: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  panelRow: { gap: 6 },
  link: { paddingVertical: 6, paddingHorizontal: space.xs },
  linkText: { fontWeight: '600', fontSize: 14 },
  obd: { gap: space.sm },
  ai: { gap: space.md },
  grow: { flex: 1 },
  addPhoto: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addPhotoText: { fontSize: 11, fontWeight: '600' },
});
