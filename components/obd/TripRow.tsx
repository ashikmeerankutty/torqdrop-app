import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { SIMULATED_COLOR } from '@/components/obd/CarStatusCard';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { space } from '@/constants/Theme';
import { useCarSettings } from '@/lib/car-settings';
import type { Trip } from '@/lib/garage/trips';
import { economy, formatDuration } from '@/lib/obd/trip-stats';

export function scoreColor(score: number | null): string {
  if (score == null) return '#757575';
  return score >= 85 ? STATUS_COLOR.good : score >= 65 ? STATUS_COLOR.attention : STATUS_COLOR.defect;
}

export function TripRow({ trip }: { trip: Trip }) {
  const { colors } = useTheme();
  const settings = useCarSettings();
  const eco = economy(trip.distanceKm, trip.fuelL, settings.economyUnit);
  const when = new Date(trip.startedAt);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/garage/trip/[id]', params: { id: String(trip.id) } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { borderTopColor: colors.border }, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <View style={[styles.score, { borderColor: scoreColor(trip.score) }]}>
        <Text variant="caption" style={{ fontWeight: '800', color: scoreColor(trip.score) }}>
          {trip.score ?? '–'}
        </Text>
      </View>
      <View style={styles.grow}>
        <Text variant="bodyStrong">
          {trip.distanceKm.toFixed(1)} km · {formatDuration(trip.durationS)}
        </Text>
        <Text variant="caption" tone="textMuted" numberOfLines={1}>
          {when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}{' '}
          {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          {eco ? ` · ${eco.value.toFixed(1)} ${eco.unit}` : ''}
          {trip.fuelL != null ? ` · ${settings.currency}${(trip.fuelL * settings.fuelPrice).toFixed(0)}` : ''}
        </Text>
      </View>
      {trip.simulated ? <Pill label="Sim" color={SIMULATED_COLOR} /> : null}
      <Icon name="chevron" size={18} tone="textSubtle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  score: { width: 36, height: 36, borderRadius: 18, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
