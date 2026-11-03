import { Alert, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { TripRow } from '@/components/obd/TripRow';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { useCarSettings } from '@/lib/car-settings';
import { useDbQuery } from '@/lib/db/use-query';
import { shareCsv } from '@/lib/export-csv';
import { listTrips, tripTotals } from '@/lib/garage/trips';
import { useActiveVehicle } from '@/lib/garage/vehicles';
import { economy, formatDuration } from '@/lib/obd/trip-stats';

export default function Trips() {
  const settings = useCarSettings();
  const { vehicle } = useActiveVehicle();
  const vid = vehicle?.id ?? null;
  const now = new Date();
  const { data } = useDbQuery(
    async () => {
      const weekStart = Date.now() - 7 * 86_400_000;
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
      const [trips, week, month, year] = await Promise.all([
        listTrips(vid, 500),
        tripTotals(vid, weekStart),
        tripTotals(vid, monthStart),
        tripTotals(vid, yearStart),
      ]);
      return { trips, totals: [['Last 7 days', week] as const, ['This month', month] as const, ['This year', year] as const] };
    },
    [vid],
    ['trips'],
  );

  async function exportAll() {
    if (!data?.trips.length) return;
    try {
      await shareCsv(
        'torqdrop-trips',
        ['start', 'end', 'distance_km', 'duration_min', 'idle_min', 'max_speed_kmh', 'fuel_l', 'fuel_estimated', 'cost', 'harsh_accel', 'harsh_brake', 'high_rev', 'score', 'simulated'],
        data.trips.map((t) => [
          new Date(t.startedAt).toISOString(),
          new Date(t.endedAt).toISOString(),
          t.distanceKm.toFixed(2),
          (t.durationS / 60).toFixed(1),
          (t.idleS / 60).toFixed(1),
          Math.round(t.maxSpeed),
          t.fuelL?.toFixed(3) ?? '',
          t.fuelEstimated ? 'yes' : 'no',
          t.fuelL != null ? (t.fuelL * settings.fuelPrice).toFixed(0) : '',
          t.harshAccel,
          t.harshBrake,
          t.highRev,
          t.score ?? '',
          t.simulated ? 'yes' : 'no',
        ]),
      );
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      <View style={styles.totals}>
        {data?.totals.map(([label, t]) => {
          const eco = economy(t.distanceKm, t.fuelL, settings.economyUnit);
          return (
            <Card key={label} style={styles.total}>
              <Text variant="caption" tone="textMuted">
                {label}
              </Text>
              <Text variant="heading">{t.distanceKm.toFixed(0)} km</Text>
              <Text variant="caption" tone="textMuted">
                {t.trips} trips · {formatDuration(t.durationS)}
              </Text>
              <Text variant="caption" tone="textMuted">
                {t.fuelL ? `${t.fuelL.toFixed(1)} L · ${settings.currency}${(t.fuelL * settings.fuelPrice).toFixed(0)}` : 'No fuel data'}
              </Text>
              {eco && (
                <Text variant="caption" tone="textMuted">
                  {eco.value.toFixed(1)} {eco.unit}
                </Text>
              )}
            </Card>
          );
        })}
      </View>
      <Card>
        {!data?.trips.length && <Text tone="textMuted">No trips yet.</Text>}
        {data?.trips.map((t) => <TripRow key={t.id} trip={t} />)}
      </Card>
      {!!data?.trips.length && <Button title="Export trips to CSV" icon="share" variant="secondary" onPress={exportAll} />}
      <Text variant="caption" tone="textSubtle">
        Totals leave out simulated trips. Fuel is the car&apos;s own fuel-rate reading where it has one, otherwise worked out from airflow, so treat it as an
        estimate and compare with a fill-up now and then.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: space.sm },
  total: { flex: 1, padding: space.md, gap: 2 },
});
