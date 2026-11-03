import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { space } from '@/constants/Theme';
import { useCarSettings } from '@/lib/car-settings';
import { useLiveTrip } from '@/lib/obd/trip-recorder';
import { economy, formatDuration } from '@/lib/obd/trip-stats';

/** The trip being recorded right now. */
export function LiveTripCard() {
  const trip = useLiveTrip();
  const settings = useCarSettings();
  if (!trip) return null;
  const eco = economy(trip.distanceKm, trip.fuelL, settings.economyUnit);
  const cost = trip.fuelL != null ? trip.fuelL * settings.fuelPrice : null;
  return (
    <Card accent={STATUS_COLOR.good} onPress={() => router.push('/garage/trips')}>
      <View style={styles.row}>
        <Icon name="record" size={16} color={STATUS_COLOR.defect} />
        <Text variant="bodyStrong" style={styles.grow}>
          Recording trip · {formatDuration(trip.durationS)}
        </Text>
        <Icon name="chevron" size={18} tone="textSubtle" />
      </View>
      <View style={styles.stats}>
        <Stat label="Distance" value={`${trip.distanceKm.toFixed(1)} km`} />
        <Stat label="Fuel" value={trip.fuelL != null ? `${trip.fuelL.toFixed(2)} L` : '–'} />
        <Stat label="Economy" value={eco ? `${eco.value.toFixed(1)} ${eco.unit}` : '–'} />
        <Stat label="Cost" value={cost != null ? `${settings.currency}${cost.toFixed(0)}` : '–'} />
      </View>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1 },
});
