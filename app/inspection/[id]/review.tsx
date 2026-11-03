import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR, VERDICT } from '@/components/inspection/status';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import type { EcuExtended, FlaggedItem, Issue, IssueKind } from '@/lib/diagnostics/evidence-engine';
import {
  aiErrorMessage,
  analyzeSectionPhotos,
  analyzeSession,
  blockersFromError,
  createReportLink,
  finalizeReport,
} from '@/lib/firebase/ai';
import { needsAiCheck } from '@/lib/firebase/photo-ai';
import { PPI_V1 } from '@/lib/diagnostics/checklists/ppi-v1';
import type { InspectionSummary } from '@/lib/firebase/inspections';
import { useInspectionReview } from '@/lib/firebase/use-review';
import { useSession } from '@/lib/auth/session';
import { FREE_REPORTS, reportsLeft } from '@/lib/billing/plans';
import { isOutOfCredits, useCredits } from '@/lib/firebase/billing';
import { setInspectorName, usePreferences } from '@/lib/preferences';

/** Matches SHARE_LINK_DAYS in the createReportLink function. */
const SHARE_DAYS = 14;

const WARNING_LABEL: Partial<Record<IssueKind, (n: number) => string>> = {
  unanswered: (n) => `${n} check${n === 1 ? '' : 's'} not answered; they'll show as "Not checked"`,
  missing_photo: (n) => `${n} check${n === 1 ? ' has' : 's have'} no photo`,
  simulated_obd: () => 'The ECU scan used simulated data; the report will say so',
};

/**
 * Review and sign-off. Shows what blocks completion, the rule-built summary, the optional AI summary,
 * and the sign-off. The server re-runs the same gate before it locks the inspection.
 */
export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const data = useInspectionReview(id);
  const prefs = usePreferences();
  const { profile } = useSession();
  const credits = useCredits();
  const [name, setName] = useState(prefs.inspectorName || profile?.fullName || '');
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  // One link per visit to this screen, reused for sharing and opening.
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [linkBusy, setLinkBusy] = useState<'share' | 'open' | null>(null);
  const [photoCheck, setPhotoCheck] = useState<{ busy: boolean; message: string | null }>({ busy: false, message: null });

  if (!data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const { inspection, review, aiSummaryFresh, photos } = data;
  const complete = inspection.status === 'complete';
  const { summary } = review;
  const verdict = VERDICT[inspection.verdict ?? summary.verdict];
  const canSign = review.ready && agreed && name.trim().length >= 2;
  const left = credits ? reportsLeft(credits) : null;
  const usesFree = !!credits && credits.freeUsed < FREE_REPORTS;
  const cost =
    left === null
      ? 'Signing off uses 1 report.'
      : usesFree
        ? 'Signing off uses your free report.'
        : `Signing off uses 1 report. You have ${left} left.`;

  const unchecked = photos.filter(needsAiCheck);
  const checking = photos.filter((p) => p.aiAnalysis?.status === 'running').length;

  /** Runs the section AI check for every section that still has unchecked photos, one at a time. */
  async function checkRemainingPhotos() {
    const sections = PPI_V1.sections.filter((sec) => unchecked.some((p) => p.sectionKey === sec.key));
    setPhotoCheck({ busy: true, message: null });
    let overCap = 0;
    let failed = 0;
    try {
      for (const sec of sections) {
        setPhotoCheck({ busy: true, message: `Checking ${sec.title}…` });
        const r = await analyzeSectionPhotos(id, sec.key);
        overCap = Math.max(overCap, r.overCap);
        failed += r.failed;
      }
      setPhotoCheck({
        busy: false,
        message: overCap
          ? `The AI photo limit for this inspection is reached. ${overCap} photo${overCap === 1 ? '' : 's'} weren't checked.`
          : failed
            ? `${failed} photo${failed === 1 ? '' : 's'} couldn't be checked. Try again.`
            : null,
      });
    } catch (e) {
      setPhotoCheck({ busy: false, message: aiErrorMessage(e) });
    }
  }

  async function generateSummary() {
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await analyzeSession(id);
      if (r.status === 'ai_unavailable') setAiError('AI could not write a summary this time. Try again.');
    } catch (e) {
      setAiError(aiErrorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }

  function signOff() {
    Alert.alert(
      'Sign off this inspection?',
      `${cost} The inspection will be locked and no further changes can be made.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign off',
          onPress: async () => {
            setSigning(true);
            setServerBlockers([]);
            try {
              setInspectorName(name.trim());
              await finalizeReport(id, name.trim());
            } catch (e) {
              if (isOutOfCredits(e)) return askToBuy();
              const blockers = blockersFromError(e);
              setServerBlockers(blockers);
              if (!blockers.length) Alert.alert('Could not sign off', aiErrorMessage(e));
            } finally {
              setSigning(false);
            }
          },
        },
      ],
    );
  }

  function askToBuy() {
    Alert.alert('No reports left', 'Buy a report pack to sign off this inspection. Your answers and photos are saved.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Buy reports', onPress: () => router.push('/plans') },
    ]);
  }

  async function getLink() {
    if (link && link.expiresAt > Date.now() + 60_000) return link;
    const next = await createReportLink(inspection.reportId!);
    setLink(next);
    return next;
  }

  async function withLink(kind: 'share' | 'open') {
    setLinkBusy(kind);
    try {
      const { url, expiresAt } = await getLink();
      if (kind === 'open') {
        await WebBrowser.openBrowserAsync(url);
      } else {
        const v = inspection.vehicle;
        const until = new Date(expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        await Share.share({
          message: `Inspection report: ${v.make} ${v.model} (${v.regNo})\n${url}\n\nThe link works until ${until}.`,
        });
      }
    } catch (e) {
      Alert.alert('Could not get the report link', aiErrorMessage(e));
    } finally {
      setLinkBusy(null);
    }
  }

  function confirmShare() {
    Alert.alert(
      'Share this report?',
      `Anyone with the link can see the report and its photos for ${SHARE_DAYS} days, including the registration number.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share link', onPress: () => withLink('share') },
      ],
    );
  }

  const warningGroups = groupWarnings(review.warnings);
  const flaggedBySection = groupBy(summary.flagged, (f) => f.sectionTitle);

  return (
    <Screen
      footer={
        complete ? (
          inspection.reportId ? (
            <>
              <Button title="Share report" icon="forward" size="lg" loading={linkBusy === 'share'} onPress={confirmShare} />
              <Button
                title="Open report"
                variant="ghost"
                loading={linkBusy === 'open'}
                disabled={!!linkBusy}
                onPress={() => withLink('open')}
              />
            </>
          ) : undefined
        ) : (
          review.ready && left === 0 ? (
            <Button title="Buy reports to sign off" icon="receipt" size="lg" onPress={() => router.push('/plans')} />
          ) : (
            <Button
              title={review.ready ? 'Sign off and complete' : `${review.blockers.length} to fix before sign-off`}
              icon={review.ready ? 'shield' : undefined}
              size="lg"
              disabled={!canSign}
              loading={signing}
              onPress={signOff}
            />
          )
        )
      }>
      <Stack.Screen options={{ title: complete ? 'Inspection summary' : 'Review and sign off' }} />

      {complete && inspection.signOff && (
        <Banner tone="success" icon="shield" title={`Signed off by ${inspection.signOff.name}`}>
          {inspection.signOff.at
            ? `${inspection.signOff.at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. This inspection is locked.`
            : 'This inspection is locked.'}
        </Banner>
      )}

      <Card accent={verdict.color}>
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: `${verdict.color}26` }]}>
            <Icon name={verdict.icon} size={26} color={verdict.color} />
          </View>
          <View style={styles.grow}>
            <Text variant="heading">{verdict.title}</Text>
            <Text variant="caption" tone="textMuted">
              {verdict.body}
            </Text>
          </View>
        </View>
        <View style={styles.counts}>
          <Count label="Defects" value={summary.counts.defect} color={summary.counts.defect ? STATUS_COLOR.defect : undefined} />
          <Count
            label="Attention"
            value={summary.counts.attention}
            color={summary.counts.attention ? STATUS_COLOR.attention : undefined}
          />
          <Count label="Not inspected" value={summary.counts.notInspected} />
          <Count label="Not answered" value={summary.counts.unanswered} />
        </View>
      </Card>

      {!complete && review.blockers.length > 0 && (
        <Card accent={STATUS_COLOR.defect}>
          <Text variant="heading">Before you can sign off</Text>
          {review.blockers.map((b, i) => (
            <IssueRow key={`${b.kind}-${b.sectionKey}-${b.itemKey}-${i}`} issue={b} inspectionId={id} />
          ))}
        </Card>
      )}

      {serverBlockers.length > 0 && (
        <Banner tone="danger" title="The server found more to fix">
          {serverBlockers.join('\n')}
        </Banner>
      )}

      {!complete && warningGroups.length > 0 && (
        <Card>
          <Text variant="label" tone="textMuted">
            Worth a look
          </Text>
          {warningGroups.map(([kind, issues]) => (
            <View key={kind} style={styles.row}>
              <Icon name="info" size={18} tone="textMuted" />
              <Text variant="caption" tone="textMuted" style={styles.grow}>
                {WARNING_LABEL[kind]?.(issues.length) ?? issues[0].message}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {!complete && (unchecked.length > 0 || checking > 0 || photoCheck.message) && (
        <Card>
          <View style={styles.row}>
            <Icon name="ai" size={20} tone="primary" />
            <Text variant="heading" style={styles.grow}>
              AI photo check
            </Text>
          </View>
          <Text variant="caption" tone="textMuted">
            {checking > 0
              ? `Checking ${checking} photo${checking === 1 ? '' : 's'}…`
              : unchecked.length > 0
                ? `${unchecked.length} photo${unchecked.length === 1 ? " hasn't" : "s haven't"} been checked yet. Findings appear on their checks for you to confirm or dismiss.`
                : 'All photos checked.'}
          </Text>
          {photoCheck.message && (
            <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
              {photoCheck.message}
            </Text>
          )}
          {unchecked.length > 0 && (
            <Button title="Check now" icon="ai" variant="secondary" loading={photoCheck.busy} onPress={checkRemainingPhotos} />
          )}
        </Card>
      )}

      <AiSummaryCard
        summary={inspection.aiSummary}
        fresh={aiSummaryFresh}
        complete={complete}
        busy={aiBusy}
        error={aiError}
        onGenerate={generateSummary}
      />

      <Text variant="label" tone="textMuted">
        Flagged checks
      </Text>
      {summary.flagged.length === 0 ? (
        <Text tone="textMuted">No checks were rated as needing attention.</Text>
      ) : (
        [...flaggedBySection].map(([section, items]) => (
          <Card key={section}>
            <Text variant="bodyStrong">{section}</Text>
            {items.map((f) => (
              <FlaggedRow key={f.itemKey} item={f} photoCount={photos.filter((p) => f.photoIds.includes(p.id)).length} />
            ))}
          </Card>
        ))
      )}

      {summary.ecu && (
        <Card>
          <View style={styles.rowBetween}>
            <Text variant="bodyStrong">ECU scan</Text>
            {summary.ecu.simulated && <Pill label="Simulated" color="#8E44AD" />}
          </View>
          <Text variant="caption" tone="textMuted">
            {summary.ecu.stored.length || summary.ecu.pending.length
              ? [
                  summary.ecu.stored.length ? `Stored: ${summary.ecu.stored.join(', ')}` : null,
                  summary.ecu.pending.length ? `Pending: ${summary.ecu.pending.join(', ')}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No trouble codes'}
            {summary.ecu.milOn != null ? ` · check-engine light ${summary.ecu.milOn ? 'on' : 'off'}` : ''}
          </Text>
          {summary.ecu.extended && <EcuExtendedLines ext={summary.ecu.extended} />}
        </Card>
      )}

      {summary.notInspected.length > 0 && (
        <>
          <Text variant="label" tone="textMuted">
            Not inspected
          </Text>
          <Card>
            {summary.notInspected.map((n) => (
              <View key={`${n.sectionKey}/${n.itemKey}`} style={styles.notInspected}>
                <Text variant="bodyStrong">
                  {n.label}
                  <Text variant="caption" tone="textMuted">
                    {'  '}
                    {n.sectionTitle}
                  </Text>
                </Text>
                <Text variant="caption" tone={n.reason ? 'textMuted' : 'danger'}>
                  {n.reason ?? 'No reason given'}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {!complete && (
        <Card highlighted={review.ready}>
          <Text variant="heading">Sign-off</Text>
          <TextField
            label="Inspector name"
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            autoCapitalize="words"
            editable={!signing}
          />
          <Pressable
            onPress={() => setAgreed((a) => !a)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            style={styles.agree}>
            <View
              style={[
                styles.checkbox,
                { borderColor: agreed ? colors.primary : colors.textSubtle, backgroundColor: agreed ? colors.primary : 'transparent' },
              ]}>
              {agreed && <Icon name="check" size={16} color={colors.onPrimary} />}
            </View>
            <Text variant="caption" style={styles.grow}>
              I inspected this vehicle in person and the answers above are accurate to the best of my knowledge.
            </Text>
          </Pressable>
          {!review.ready && (
            <Text variant="caption" tone="textMuted">
              Sign-off opens once everything under “Before you can sign off” is fixed.
            </Text>
          )}
          <Text variant="caption" tone={left === 0 ? 'danger' : 'textMuted'}>
            {left === 0 ? "You have no reports left. Buy a pack to sign off; everything you've entered is saved." : cost}
          </Text>
        </Card>
      )}

      <Text variant="caption" tone="textSubtle" style={styles.disclaimer}>
        TorqDrop is an inspection assistant, not a mechanical guarantee.
      </Text>
    </Screen>
  );
}

function Count({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.count}>
      <Text variant="metric" style={[styles.countValue, color ? { color } : null]}>
        {value}
      </Text>
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
    </View>
  );
}

function IssueRow({ issue, inspectionId }: { issue: Issue; inspectionId: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/inspection/${inspectionId}/${issue.sectionKey}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.issue, { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' }]}>
      <Icon name={ISSUE_ICON[issue.kind]} size={18} color={STATUS_COLOR.defect} />
      <Text variant="caption" style={styles.grow}>
        {issue.message}
      </Text>
      <Icon name="chevron" size={18} tone="textSubtle" />
    </Pressable>
  );
}

const ISSUE_ICON: Record<IssueKind, 'error' | 'warning' | 'camera' | 'ai' | 'upload' | 'info'> = {
  critical_unanswered: 'error',
  missing_reason: 'warning',
  unverified_ai: 'ai',
  contradiction: 'warning',
  obd_cleared: 'warning',
  odometer_mismatch: 'warning',
  missing_photo: 'camera',
  photo_uploading: 'upload',
  unanswered: 'info',
  simulated_obd: 'info',
};

function FlaggedRow({ item, photoCount }: { item: FlaggedItem; photoCount: number }) {
  const color = STATUS_COLOR[item.status];
  return (
    <View style={styles.flagged}>
      <View style={styles.rowBetween}>
        <Text variant="body" style={styles.grow}>
          {item.label}
        </Text>
        <Pill label={item.status === 'defect' ? 'Defect' : 'Attention'} color={color} />
      </View>
      {item.value && (
        <Text variant="caption" tone="textMuted">
          {item.value}
        </Text>
      )}
      {item.remarks && <Text variant="caption">“{item.remarks}”</Text>}
      {item.findings.map((f) => (
        <View key={f.id} style={styles.row}>
          <Icon name="check" size={14} tone="textMuted" />
          <Text variant="caption" tone="textMuted" style={styles.grow}>
            Confirmed: {f.observedCondition}
          </Text>
        </View>
      ))}
      <View style={styles.row}>
        {photoCount > 0 && (
          <View style={styles.evidence}>
            <Icon name="camera" size={14} tone="textMuted" />
            <Text variant="caption" tone="textMuted">
              {photoCount} photo{photoCount === 1 ? '' : 's'}
            </Text>
          </View>
        )}
        {item.obdReadId && (
          <View style={styles.evidence}>
            <Icon name="bluetooth" size={14} tone="textMuted" />
            <Text variant="caption" tone="textMuted">
              Read from car
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function AiSummaryCard({
  summary,
  fresh,
  complete,
  busy,
  error,
  onGenerate,
}: {
  summary: InspectionSummary['aiSummary'];
  fresh: boolean;
  complete: boolean;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const { colors } = useTheme();
  // A completed inspection only shows the summary that went into its report.
  if (complete && (!summary || !fresh)) return null;
  return (
    <Card>
      <View style={styles.row}>
        <Icon name="ai" size={20} tone="primary" />
        <Text variant="heading" style={styles.grow}>
          AI summary
        </Text>
        {summary && !fresh && <Pill label="Out of date" color={STATUS_COLOR.attention} />}
      </View>
      {summary ? (
        <View style={[styles.aiBody, !fresh && styles.stale]}>
          <Text variant="body">{summary.overview}</Text>
          {summary.hypotheses.map((h, i) => (
            <View key={i} style={[styles.hypothesis, { backgroundColor: colors.surfaceRaised }]}>
              <Text variant="caption" tone="textMuted">
                {h.basis === 'measured' ? 'Measured' : h.basis === 'ai_observation' ? 'AI observation' : 'Inspector observed'} ·{' '}
                {h.confidence} confidence · possibility, not a diagnosis
              </Text>
              <Text variant="bodyStrong">{h.statement}</Text>
              <Text variant="caption">Next: {h.nextStep}</Text>
              <Text variant="caption" tone="textSubtle">
                Based on: {h.evidenceRefs.join(', ')}
              </Text>
            </View>
          ))}
          <Text variant="caption" tone="textSubtle">
            Written by AI from the checks below. It can be wrong; the checks are the record.
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="textMuted">
          A plain-language summary for the buyer, written from the flagged checks, codes and confirmed findings. Optional.
        </Text>
      )}
      {error && (
        <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
          {error}
        </Text>
      )}
      {!complete && (!summary || !fresh) && (
        <Button
          title={summary ? 'Update AI summary' : 'Write AI summary'}
          icon="ai"
          variant="secondary"
          loading={busy}
          onPress={onGenerate}
        />
      )}
      {!complete && summary && !fresh && (
        <Text variant="caption" tone="textMuted">
          The checks changed since this was written. Only an up-to-date summary goes into the report.
        </Text>
      )}
    </Card>
  );
}

function groupWarnings(warnings: Issue[]): [IssueKind, Issue[]][] {
  return [...groupBy(warnings, (w) => w.kind)];
}

function groupBy<T, K>(list: T[], key: (x: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
  return map;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  grow: { flex: 1 },
  badge: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  counts: { flexDirection: 'row', marginTop: space.sm },
  count: { flex: 1, alignItems: 'center', gap: 2 },
  countValue: { fontSize: 24 },
  issue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderRadius: radius.sm },
  flagged: { gap: 4, paddingVertical: space.sm },
  evidence: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: space.md },
  notInspected: { gap: 2, paddingVertical: space.xs },
  aiBody: { gap: space.md },
  stale: { opacity: 0.55 },
  hypothesis: { borderRadius: radius.md, padding: space.md, gap: 4 },
  agree: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.xs },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { textAlign: 'center' },
});

function EcuExtendedLines({ ext }: { ext: EcuExtended }) {
  const incomplete = ext.monitors.filter((m) => !m.complete);
  const lines = [
    ext.vin ? `VIN reported by the car: ${ext.vin}` : null,
    ext.odometerKm != null ? `Odometer reported by the engine computer: ${Math.round(ext.odometerKm).toLocaleString('en-IN')} km` : null,
    ext.distanceSinceClearKm != null ? `Distance since codes were last cleared: ${Math.round(ext.distanceSinceClearKm).toLocaleString('en-IN')} km` : null,
    ext.monitors.length ? (incomplete.length ? `Self-tests not finished: ${incomplete.map((m) => m.name).join(', ')}` : 'All emissions self-tests complete') : null,
    ext.permanent.length ? `Permanent codes: ${ext.permanent.join(', ')}` : null,
  ].filter(Boolean);
  return (
    <>
      {lines.map((l) => (
        <Text key={l} variant="caption" tone="textMuted">
          {l}
        </Text>
      ))}
      {ext.flags.map((f) => (
        <Text key={f.id} variant="caption" style={{ color: STATUS_COLOR.attention, fontWeight: '600' }}>
          {f.title}
        </Text>
      ))}
    </>
  );
}
