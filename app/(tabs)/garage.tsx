import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { STATUS_COLOR } from '@/components/inspection/status';
import { LiveTripCard } from '@/components/obd/LiveTripCard';
import { TripRow } from '@/components/obd/TripRow';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { updateCarSettings, useCarSettings } from '@/lib/car-settings';
import { useDbQuery } from '@/lib/db/use-query';
import { listTrips, statsHistory, tripTotals } from '@/lib/garage/trips';
import {
  currentOdometer,
  deleteVehicle,
  formatDue,
  FUEL_LABEL,
  listReminders,
  reminderStatus,
  useActiveVehicle,
  type Vehicle,
} from '@/lib/garage/vehicles';
import { confirmConnectedCar, connectedCarIs, connectedCarIsNew, detachVehicle, useObd } from '@/lib/obd/connection';
import { economy, trendFlags } from '@/lib/obd/trip-stats';

export default function Garage() {
  const { vehicle, vehicles, loading } = useActiveVehicle();
  const obd = useObd();

  if (loading) return <Screen>{null}</Screen>;
  if (!vehicle) {
    return (
      <Screen>
        <ConnectionNotice vehicles={vehicles} />
        <EmptyState
          icon="garage"
          title="Your garage is empty"
          body="Connect an OBD adapter to your car and it's added here automatically, or add it yourself."
        />
        <Button title="Add a car" icon="add" onPress={() => router.push('/garage/vehicle')} />
        {obd.status !== 'connected' && (
          <Button title="Connect adapter" icon="bluetooth" variant="secondary" onPress={() => router.push('/connect')} />
        )}
      </Screen>
    );
  }
  return <VehicleOverview vehicle={vehicle} vehicles={vehicles} />;
}

function VehicleOverview({ vehicle, vehicles }: { vehicle: Vehicle; vehicles: Vehicle[] }) {
  const settings = useCarSettings();
  const obd = useObd();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const { data } = useDbQuery(
    async () => {
      const [odo, reminders, trips, month, history] = await Promise.all([
        currentOdometer(vehicle),
        listReminders(vehicle.id),
        listTrips(vehicle.id, 5),
        tripTotals(vehicle.id, monthStart),
        statsHistory(vehicle.id),
      ]);
      return { odo, reminders, trips, month, history };
    },
    [vehicle.id, vehicle.odometerKm, vehicle.odometerAt],
    ['trips', 'reminders', 'maintenance', 'vehicles'],
  );
  const odo = data?.odo ?? null;
  const statuses = (data?.reminders ?? []).map((r) => reminderStatus(r, odo)).sort((a, b) => rank(a.state) - rank(b.state));
  const due = statuses.filter((s) => s.state === 'due' || s.state === 'soon');
  const unknown = statuses.filter((s) => s.state === 'unknown').length;
  const month = data?.month;
  const eco = month ? economy(month.distanceKm, month.fuelL, settings.economyUnit) : null;
  const flags = trendFlags(data?.history ?? []);
  const connectedHere = obd.status === 'connected' && obd.vehicleId === vehicle.id;

  function confirmRemove() {
    Alert.alert(`Remove ${vehicle.name}?`, 'Its trips, performance runs, service log and reminders on this phone are deleted too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteVehicle(vehicle.id);
          detachVehicle(vehicle.id);
        },
      },
    ]);
  }

  return (
    <Screen>
      <ConnectionNotice vehicles={vehicles} />
      {vehicles.length > 1 && (
        <View style={styles.chips}>
          {vehicles.map((v) => (
            <Chip key={v.id} label={v.name} selected={v.id === vehicle.id} onPress={() => updateCarSettings({ activeVehicleId: v.id })} />
          ))}
        </View>
      )}

      <Card onPress={() => router.push({ pathname: '/garage/vehicle', params: { id: vehicle.id } })}>
        <View style={styles.row}>
          <Icon name="car" size={32} tone="primary" />
          <View style={styles.grow}>
            <Text variant="title" numberOfLines={1}>
              {vehicle.name}
            </Text>
            <Text variant="caption" tone="textMuted" numberOfLines={1}>
              {[vehicle.make, vehicle.model, vehicle.year, FUEL_LABEL[vehicle.fuel]].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Icon name="edit" size={18} tone="textSubtle" />
        </View>
        <View style={styles.row}>
          <Fact label="Odometer" value={odo != null ? `${Math.round(odo).toLocaleString()} km` : 'Not set'} />
          <Fact label="This month" value={month ? `${month.distanceKm.toFixed(0)} km` : '–'} />
          <Fact label="Economy" value={eco ? `${eco.value.toFixed(1)} ${eco.unit}` : '–'} />
        </View>
        {connectedHere && (
          <Text variant="caption" style={{ color: STATUS_COLOR.good, fontWeight: '700' }}>
            ● Connected now{obd.simulated ? ' (simulated)' : ''}
          </Text>
        )}
      </Card>

      <LiveTripCard />

      <Card onPress={() => router.push({ pathname: '/garage/maintenance', params: { id: vehicle.id } })}>
        <View style={styles.row}>
          <Text variant="heading" style={styles.grow}>
            Service
          </Text>
          <Icon name="chevron" size={18} tone="textSubtle" />
        </View>
        {due.length === 0 && (
          <Text tone="textMuted">
            {odo == null || unknown === statuses.length ? 'Set the odometer and your last service to get reminders.' : 'Nothing due soon.'}
          </Text>
        )}
        {due.slice(0, 4).map((s) => (
          <View key={s.reminder.id} style={styles.row}>
            <Icon name={s.state === 'due' ? 'error' : 'warning'} size={16} color={s.state === 'due' ? STATUS_COLOR.defect : STATUS_COLOR.attention} />
            <Text style={styles.grow}>{s.reminder.title}</Text>
            <Text variant="caption" tone="textMuted">
              {formatDue(s.kmLeft, s.daysLeft)}
            </Text>
          </View>
        ))}
      </Card>

      {flags.length > 0 && (
        <Card accent={STATUS_COLOR.attention}>
          <Text variant="label" tone="textMuted">
            Changes noticed over recent drives
          </Text>
          {flags.map((f) => (
            <View key={f.key} style={{ gap: 2 }}>
              <Text variant="bodyStrong">{f.title}</Text>
              <Text variant="caption" tone="textMuted">
                {f.body}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <View style={styles.row}>
          <Text variant="heading" style={styles.grow}>
            Recent trips
          </Text>
          <Button title="All trips" variant="ghost" onPress={() => router.push('/garage/trips')} style={styles.compact} />
        </View>
        {!data?.trips.length && (
          <Text tone="textMuted">
            {settings.autoTrips ? 'Trips are recorded automatically while the adapter is connected and the app is open.' : 'Automatic trips are off in settings.'}
          </Text>
        )}
        {data?.trips.map((t) => <TripRow key={t.id} trip={t} />)}
      </Card>

      <View style={styles.links}>
        <LinkRow icon="hearing" title="Engine sound checks" onPress={() => router.push('/engine-check')} />
        <LinkRow icon="timer" title="Performance times" onPress={() => router.push('/obd/performance')} />
        <LinkRow icon="tune" title="Car and alert settings" onPress={() => router.push('/garage/settings')} />
        <LinkRow icon="add" title="Add another car" onPress={() => router.push('/garage/vehicle')} />
        <LinkRow icon="delete" title={`Remove ${vehicle.name}`} onPress={confirmRemove} />
      </View>
    </Screen>
  );
}

/**
 * What the connected car is in the garage. When it couldn't be identified for sure (no VIN, never
 * seen before), asks so the person can fix the match in one tap.
 */
function ConnectionNotice({ vehicles }: { vehicles: Vehicle[] }) {
  const obd = useObd();
  const [busy, setBusy] = useState(false);
  if (obd.status !== 'connected') return null;
  if (obd.simulated) {
    return (
      <Card>
        <Banner tone="info">Connected to the simulated car. It&apos;s for trying the app out, so it isn&apos;t saved to your garage.</Banner>
        <Button title="Switch to your real adapter" icon="bluetooth" variant="secondary" onPress={() => router.push('/connect')} />
      </Card>
    );
  }
  if (!obd.vehicleId) {
    return (
      <Text variant="caption" tone="textMuted">
        Identifying the connected car…
      </Text>
    );
  }
  const match = obd.vehicleMatch;
  const car = vehicles.find((v) => v.id === obd.vehicleId);
  if (!car || (match !== 'new' && match !== 'assumed')) return null;
  const others = vehicles.filter((v) => v.id !== car.id);
  const noVin = !obd.info?.vin;

  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card accent={STATUS_COLOR.attention}>
      <Text variant="heading">{match === 'new' ? `Added the connected car as “${car.name}”` : `Is the connected car your ${car.name}?`}</Text>
      <Text tone="textMuted">
        {noVin
          ? "This car doesn't report its VIN (many don't, especially older and Indian-market models), so it can't be recognised for sure. "
          : ''}
        {match === 'new' ? 'Give it a name and a few details for better fuel and power estimates.' : `It was linked to ${car.name} because that's your selected car.`}
      </Text>
      {match === 'new' ? (
        <Button title="Name it and add details" icon="edit" disabled={busy} onPress={() => {
          confirmConnectedCar();
          router.push({ pathname: '/garage/vehicle', params: { id: car.id } });
        }} />
      ) : (
        <>
          <Button title={`Yes, it's ${car.name}`} disabled={busy} onPress={confirmConnectedCar} />
          <Button
            title="No, it's a different car"
            variant="secondary"
            disabled={busy}
            onPress={run(async () => {
              const id = await connectedCarIsNew();
              if (id) router.push({ pathname: '/garage/vehicle', params: { id } });
            })}
          />
        </>
      )}
      {others.length > 0 && (
        <>
          <Text variant="caption" tone="textMuted">
            {match === 'new' ? 'Already in your garage? It’s my:' : 'Or it’s my:'}
          </Text>
          <View style={styles.chips}>
            {others.map((v) => (
              <Chip key={v.id} label={v.name} selected={false} onPress={run(() => connectedCarIs(v.id))} />
            ))}
          </View>
        </>
      )}
    </Card>
  );
}

const rank = (s: string) => ({ due: 0, soon: 1, ok: 2, unknown: 3 })[s] ?? 4;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.grow}>
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ icon, title, onPress }: { icon: IconName; title: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.link, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <Icon name={icon} size={20} tone="primary" />
      <Text style={styles.grow}>{title}</Text>
      <Icon name="chevron" size={18} tone="textSubtle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  compact: { minHeight: 32, paddingVertical: 0, paddingHorizontal: space.sm },
  links: { gap: space.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: 16, padding: space.md, minHeight: 52 },
});
