import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { INSPECTION_STATUS, SECTION_ICON, SECTION_STATUS, STATUS_COLOR } from '@/components/inspection/status';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RegPlate } from '@/components/ui/RegPlate';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { PPI_V1 } from '@/lib/diagnostics/checklists/ppi-v1';
import { sectionProgress } from '@/lib/diagnostics/checklists/types';
import {
  type InspectionSummary,
  type SectionDoc,
  subscribeInspection,
  subscribeSections,
  syncProgress,
} from '@/lib/firebase/inspections';

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const [inspection, setInspection] = useState<InspectionSummary | null>(null);
  const [sections, setSections] = useState<Record<string, SectionDoc> | null>(null);

  // Subscribed while focused, so coming back from a section always starts from a fresh snapshot.
  useFocusEffect(useCallback(() => subscribeInspection(id, setInspection), [id]));
  useFocusEffect(useCallback(() => subscribeSections(id, setSections), [id]));

  const counts = sections
    ? PPI_V1.sections.reduce(
        (n, s) => {
          const p = sectionProgress(s, sections[s.key]?.items ?? {});
          return { answered: n.answered + p.answered, total: n.total + p.total };
        },
        { answered: 0, total: 0 },
      )
    : null;
  const stored = inspection?.progress;
  const drifted =
    !!counts && !!inspection && inspection.status !== 'complete' &&
    (stored?.answered !== counts.answered || stored?.total !== counts.total);
  useEffect(() => {
    if (drifted && counts) syncProgress(id, counts.answered, counts.total);
  }, [drifted, counts?.answered, counts?.total, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!inspection || !sections) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Progress is recomputed from the items so it's right even for sections only touched by a photo.
  const progress = PPI_V1.sections.map((s) => ({ section: s, ...sectionProgress(s, sections[s.key]?.items ?? {}) }));
  const answered = progress.reduce((n, p) => n + p.answered, 0);
  const total = progress.reduce((n, p) => n + p.total, 0);
  const openCritical = progress.reduce((n, p) => n + p.openCritical.length, 0);
  const issues = progress.filter((p) => p.status === 'needs_investigation').length;
  // Critical checks first: they decide whether the car is worth buying at all.
  const next = progress.find((p) => p.openCritical.length > 0) ?? progress.find((p) => p.answered < p.total);
  const v = inspection.vehicle;
  const details = sections.vehicle_details?.items ?? {};
  const facts = [v.year, details.fuel_type?.value, details.transmission?.value, km(details.odometer?.value)].filter(Boolean);
  const status = INSPECTION_STATUS[inspection.status] ?? INSPECTION_STATUS.draft;
  const complete = inspection.status === 'complete';
  const pct = total ? answered / total : 0;

  return (
    <Screen
      footer={
        complete ? (
          <Button title="View summary" icon="inspections" size="lg" onPress={() => router.push(`/inspection/${id}/review`)} />
        ) : next ? (
          <>
            <Button
              title={answered === 0 ? `Start with ${next.section.title}` : `Continue: ${next.section.title}`}
              icon="forward"
              size="lg"
              onPress={() => router.push(`/inspection/${id}/${next.section.key}`)}
            />
            {answered > 0 && (
              <Button title="Review progress" variant="ghost" onPress={() => router.push(`/inspection/${id}/review`)} />
            )}
          </>
        ) : (
          <Button title="Review and sign off" icon="shield" size="lg" onPress={() => router.push(`/inspection/${id}/review`)} />
        )
      }>
      <Stack.Screen options={{ title: '' }} />

      <View style={styles.hero}>
        <Text variant="title">
          {v.make} {v.model}
          {v.variant ? <Text variant="title" tone="textMuted"> {v.variant}</Text> : null}
        </Text>
        <View style={styles.heroRow}>
          <RegPlate regNo={v.regNo} size="md" />
          <Pill label={status.label} color={status.color} />
        </View>
        {facts.length > 0 && (
          <Text variant="caption" tone="textMuted">
            {facts.join('  ·  ')}
          </Text>
        )}
      </View>

      {complete && inspection.signOff && (
        <Banner tone="success" icon="shield" title={`Signed off by ${inspection.signOff.name}`}>
          This inspection is locked. Answers can be viewed but not changed.
        </Banner>
      )}

      <Card>
        <View style={styles.progressTop}>
          <Text variant="display" style={styles.pct}>
            {Math.round(pct * 100)}
            <Text variant="heading" tone="textMuted">
              %
            </Text>
          </Text>
          <View style={styles.progressFacts}>
            <Text variant="bodyStrong">
              {answered} of {total} checks
            </Text>
            <Text variant="caption" tone={openCritical ? 'danger' : 'textMuted'}>
              {openCritical ? `${openCritical} critical check${openCritical === 1 ? '' : 's'} left` : 'All critical checks done'}
            </Text>
            {issues > 0 && (
              <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
                {issues} section{issues === 1 ? '' : 's'} need attention
              </Text>
            )}
          </View>
        </View>
        <ProgressBar value={pct} height={8} />
      </Card>

      <Text variant="label" tone="textMuted">
        Sections
      </Text>
      <View style={styles.list}>
        {progress.map((p) => {
          const s = SECTION_STATUS[p.status];
          const started = p.answered > 0;
          const done = p.answered === p.total;
          const isNext = !complete && next?.section.key === p.section.key;
          return (
            <Card
              key={p.section.key}
              highlighted={isNext}
              onPress={() => router.push(`/inspection/${id}/${p.section.key}`)}
              accessibilityLabel={`${p.section.title}, ${p.answered} of ${p.total} done`}
              style={styles.sectionCard}>
              <View style={styles.sectionRow}>
                <View
                  style={[
                    styles.iconBadge,
                    { backgroundColor: done ? `${s.color}26` : isNext ? colors.primarySoft : colors.surfaceRaised },
                  ]}>
                  <Icon
                    name={done && p.status === 'complete' ? 'check' : (SECTION_ICON[p.section.key] ?? 'inspections')}
                    size={22}
                    color={done ? s.color : isNext ? colors.primary : colors.textMuted}
                  />
                </View>
                <View style={styles.grow}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {p.section.title}
                  </Text>
                  <View style={styles.sectionMeta}>
                    <Text variant="caption" tone="textMuted" style={styles.count}>
                      {p.answered}/{p.total}
                    </Text>
                    {p.openCritical.length > 0 && (
                      <Text variant="caption" tone="danger">
                        {p.openCritical.length} critical left
                      </Text>
                    )}
                  </View>
                  {started && !done && <ProgressBar value={p.answered / p.total} height={4} />}
                </View>
                {started && p.status !== 'not_started' ? (
                  <Pill label={s.label} color={s.color} />
                ) : (
                  <Icon name="chevron" size={20} tone="textSubtle" />
                )}
              </View>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}

function km(value: unknown) {
  return typeof value === 'number' ? `${value.toLocaleString('en-IN')} km` : null;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { gap: space.sm },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  progressTop: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  pct: { fontVariant: ['tabular-nums'] },
  progressFacts: { flex: 1, gap: 2 },
  list: { gap: space.sm },
  sectionCard: { paddingVertical: space.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  iconBadge: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, gap: 4 },
  sectionMeta: { flexDirection: 'row', gap: space.sm },
  count: { fontVariant: ['tabular-nums'] },
});
