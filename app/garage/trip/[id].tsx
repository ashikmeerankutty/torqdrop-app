import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { TimeChart } from '@/components/gauges/Charts';
import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { RouteMap } from '@/components/obd/RouteMap';
import { scoreColor } from '@/components/obd/TripRow';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { useCarSettings } from '@/lib/car-settings';
import { useDbQuery } from '@/lib/db/use-query';
import { shareCsv } from '@/lib/export-csv';
import { deleteTrip, getTrip, getTripSamples, type TripSample } from '@/lib/garage/trips';
import { economy, formatDuration } from '@/lib/obd/trip-stats';

type ColourBy = 'speed' | 'rpm' | 'economy';

const SERIES: { key: keyof TripSample; title: string; unit: string; decimals: number }[] = [
  { key: 'speed', title: 'Speed', unit: 'km/h', decimals: 0 },
  { key: 'rpm', title: 'Engine speed', unit: 'rpm', decimals: 0 },
  { key: 'fuelLph', title: 'Fuel flow (est.)', unit: 'L/h', decimals: 1 },
  { key: 'coolant', title: 'Coolant temperature', unit: '°C', decimals: 0 },
];

export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const settings = useCarSettings();
  const [colourBy, setColourBy] = useState<ColourBy>('speed');
  const [width, setWidth] = useState(0);
  const { data } = useDbQuery(async () => ({ trip: await getTrip(Number(id)), samples: await getTripSamples(Number(id)) }), [id], ['trips']);
  const trip = data?.trip;
  const samples = data?.samples ?? [];

  if (!data) return <Screen>{null}</Screen>;
  if (!trip) {
    return (
      <Screen>
        <Text tone="textMuted">This trip was deleted.</Text>
      </Screen>
    );
  }

  const eco = economy(trip.distanceKm, trip.fuelL, settings.economyUnit);
  const start = new Date(trip.startedAt);
  const route = samples
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => ({
      lat: s.lat!,
      lon: s.lon!,
      value: colourBy === 'economy' ? (s.speed && s.fuelLph ? Math.min(40, s.speed / s.fuelLph) : null) : s[colourBy],
    }));
  const duration = samples.length ? samples[samples.length - 1].t - samples[0].t : 0;
  const inner = width - space.lg * 2 - 2;

  function confirmDelete() {
    Alert.alert('Delete this trip?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTrip(trip!.id);
          router.back();
        },
      },
    ]);
  }

  async function exportSamples() {
    try {
      await shareCsv(
        `torqdrop-trip-${start.toISOString().slice(0, 16)}`,
        ['time', 'lat', 'lon', 'speed_kmh', 'rpm', 'throttle_pct', 'fuel_lph', 'coolant_c'],
        samples.map((s) => [new Date(s.t).toISOString(), s.lat, s.lon, s.speed, s.rpm, s.throttle?.toFixed(0), s.fuelLph?.toFixed(2), s.coolant]),
      );
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) }} />
      {!!trip.simulated && <Banner tone="info" icon="play">Recorded from the simulated car.</Banner>}
      <Card accent={scoreColor(trip.score)}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Text variant="title">{trip.distanceKm.toFixed(1)} km</Text>
            <Text variant="caption" tone="textMuted">
              {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} ·{' '}
              {formatDuration(trip.durationS)}
            </Text>
          </View>
          <View style={styles.scoreBox}>
            <Text variant="title" style={{ color: scoreColor(trip.score) }}>
              {trip.score ?? '–'}
            </Text>
            <Text variant="caption" tone="textMuted">
              drive score
            </Text>
          </View>
        </View>
        <View style={styles.grid}>
          <Stat label="Fuel used" value={trip.fuelL != null ? `${trip.fuelL.toFixed(2)} L${trip.fuelEstimated ? ' (est.)' : ''}` : '–'} />
          <Stat label="Economy" value={eco ? `${eco.value.toFixed(1)} ${eco.unit}` : '–'} />
          <Stat label="Cost" value={trip.fuelL != null ? `${settings.currency}${(trip.fuelL * settings.fuelPrice).toFixed(0)}` : '–'} />
          <Stat label="Average speed" value={trip.movingS > 0 ? `${((trip.distanceKm / trip.movingS) * 3600).toFixed(0)} km/h moving` : '–'} />
          <Stat label="Top speed" value={`${Math.round(trip.maxSpeed)} km/h`} />
          <Stat label="Idling" value={`${formatDuration(trip.idleS)} (${trip.durationS ? Math.round((trip.idleS / trip.durationS) * 100) : 0} %)`} />
          <Stat label="Harsh acceleration" value={String(trip.harshAccel)} />
          <Stat label="Harsh braking" value={String(trip.harshBrake)} />
          <Stat label="Near redline" value={String(trip.highRev)} />
        </View>
      </Card>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: space.lg }}>
        {route.length >= 2 ? (
          <Card>
            <View style={styles.chips}>
              {(['speed', 'rpm', 'economy'] as const).map((c) => (
                <Chip key={c} label={c === 'rpm' ? 'Engine speed' : c === 'speed' ? 'Speed' : 'Economy'} selected={colourBy === c} onPress={() => setColourBy(c)} />
              ))}
            </View>
            {width > 0 && (
              <RouteMap
                points={route}
                width={inner}
                label={colourBy === 'rpm' ? 'Engine speed' : colourBy === 'speed' ? 'Speed' : 'Economy'}
                unit={colourBy === 'rpm' ? 'rpm' : colourBy === 'speed' ? 'km/h' : 'km/L'}
                decimals={colourBy === 'economy' ? 1 : 0}
              />
            )}
          </Card>
        ) : (
          <Text variant="caption" tone="textMuted">
            No GPS route for this trip. Allow location in Garage → settings to draw routes.
          </Text>
        )}

        {width > 0 &&
          duration > 0 &&
          SERIES.map((s) => {
            const pts = samples.filter((x) => typeof x[s.key] === 'number').map((x) => ({ t: x.t, v: x[s.key] as number }));
            if (pts.length < 2) return null;
            return (
              <Card key={s.key}>
                <TimeChart title={s.title} unit={s.unit} decimals={s.decimals} points={pts} width={inner} windowMs={duration} relative="start" min={0} />
              </Card>
            );
          })}
      </View>

      {trip.stats && (
        <Card>
          <Text variant="heading">Car health on this drive</Text>
          {trip.stats.runningVoltage != null && <Stat label="Charging voltage (average)" value={`${trip.stats.runningVoltage.toFixed(2)} V`} />}
          {trip.stats.warmupS != null && <Stat label="Warm-up to 80 °C" value={formatDuration(trip.stats.warmupS)} />}
          {trip.stats.maxCoolant != null && <Stat label="Highest coolant temperature" value={`${Math.round(trip.stats.maxCoolant)} °C`} />}
          {trip.stats.ltft != null && <Stat label="Long-term fuel trim (warm)" value={`${trip.stats.ltft.toFixed(1)} %`} />}
          {trip.stats.idleRpm != null && <Stat label="Warm idle speed" value={`${Math.round(trip.stats.idleRpm)} rpm`} />}
        </Card>
      )}

      <Button title="Export samples to CSV" icon="share" variant="secondary" onPress={exportSamples} />
      <Button title="Delete trip" variant="danger" onPress={confirmDelete} />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="textMuted" style={styles.grow}>
        {label}
      </Text>
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scoreBox: { alignItems: 'center' },
  grid: { gap: 4 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
