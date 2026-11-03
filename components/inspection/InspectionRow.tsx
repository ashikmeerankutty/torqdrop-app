import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RegPlate } from '@/components/ui/RegPlate';
import { space } from '@/constants/Theme';
import type { InspectionSummary } from '@/lib/firebase/inspections';

import { INSPECTION_STATUS, VERDICT } from './status';

export function InspectionRow({ inspection, highlighted }: { inspection: InspectionSummary; highlighted?: boolean }) {
  const { vehicle: v, progress } = inspection;
  const status = INSPECTION_STATUS[inspection.status] ?? INSPECTION_STATUS.draft;
  const pct = progress?.total ? progress.answered / progress.total : null;

  return (
    <Card
      highlighted={highlighted}
      onPress={() => router.push(`/inspection/${inspection.id}`)}
      accessibilityLabel={`${v.make} ${v.model}, ${v.regNo}, ${status.label}`}>
      <View style={styles.top}>
        <View style={styles.grow}>
          <Text variant="heading" numberOfLines={1}>
            {v.make} {v.model}
            {v.variant ? <Text tone="textMuted"> {v.variant}</Text> : null}
          </Text>
          <View style={styles.meta}>
            <RegPlate regNo={v.regNo} size="sm" />
            {v.year ? (
              <Text variant="caption" tone="textMuted">
                {v.year}
              </Text>
            ) : null}
          </View>
        </View>
        <Icon name="chevron" size={20} tone="textSubtle" />
      </View>
      {pct !== null && inspection.status !== 'complete' && (
        <View style={styles.progress}>
          <View style={styles.bar}>
            <ProgressBar value={pct} />
          </View>
          <Text variant="caption" tone="textMuted" style={styles.pct}>
            {Math.round(pct * 100)}%
          </Text>
        </View>
      )}
      <View style={styles.footer}>
        <View style={styles.meta}>
          <Pill label={status.label} color={status.color} />
          {inspection.verdict && (
            <Text variant="caption" style={{ color: VERDICT[inspection.verdict].color, fontWeight: '600' }}>
              {VERDICT[inspection.verdict].title}
            </Text>
          )}
        </View>
        {inspection.updatedAt && (
          <Text variant="caption" tone="textSubtle">
            {relativeTime(inspection.updatedAt)}
          </Text>
        )}
      </View>
    </Card>
  );
}

export function relativeTime(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  // Takes the space left by the percentage; the bar's own 100% width would push past the card.
  bar: { flex: 1 },
  pct: { minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
