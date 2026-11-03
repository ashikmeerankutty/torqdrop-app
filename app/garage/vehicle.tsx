import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { updateCarSettings } from '@/lib/car-settings';
import {
  createVehicle,
  currentOdometer,
  deleteVehicle,
  FUEL_LABEL,
  type FuelKind,
  getVehicle,
  updateVehicle,
  type Vehicle,
} from '@/lib/garage/vehicles';
import { detachVehicle } from '@/lib/obd/connection';
import { getMetricsVehicle, setMetricsVehicle } from '@/lib/obd/metrics';
import { decodeVin } from '@/lib/obd/modes';

const FUELS = Object.keys(FUEL_LABEL) as FuelKind[];

type Form = Record<'name' | 'make' | 'model' | 'year' | 'displacementL' | 'weightKg' | 'redlineRpm' | 'tankL' | 'odometerKm' | 'vin', string>;

const toForm = (v: Vehicle | null, odo: number | null): Form => ({
  name: v?.name ?? '',
  make: v?.make ?? '',
  model: v?.model ?? '',
  year: v?.year?.toString() ?? '',
  displacementL: v?.displacementL?.toString() ?? '',
  weightKg: v?.weightKg?.toString() ?? '',
  redlineRpm: v?.redlineRpm?.toString() ?? '',
  tankL: v?.tankL?.toString() ?? '',
  odometerKm: odo != null ? Math.round(odo).toString() : '',
  vin: v?.vin ?? '',
});

const num = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Add a car, or edit one's details. Engine size, weight and redline make the estimates better. */
export default function VehicleForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Form>(toForm(null, null));
  const [fuel, setFuel] = useState<FuelKind>('petrol');
  const [initialOdo, setInitialOdo] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getVehicle(id).then(async (v) => {
      if (!v) return;
      const odo = await currentOdometer(v);
      setVehicle(v);
      setInitialOdo(odo);
      setForm(toForm(v, odo));
      setFuel(v.fuel);
    });
  }, [id]);

  const set = (k: keyof Form) => (text: string) => setForm((f) => ({ ...f, [k]: text }));

  async function save() {
    if (!form.name.trim()) return Alert.alert('Give the car a name', 'For example "Swift" or "Dad\'s car".');
    setSaving(true);
    try {
      const vin = form.vin.trim().toUpperCase() || null;
      const patch = {
        name: form.name.trim(),
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        year: num(form.year),
        fuel,
        displacementL: num(form.displacementL),
        weightKg: num(form.weightKg),
        redlineRpm: num(form.redlineRpm),
        tankL: num(form.tankL),
        vin,
      };
      const odo = num(form.odometerKm);
      // Only reset the odometer baseline when the person changed it.
      const odoPatch = odo != null && (initialOdo == null || Math.round(initialOdo) !== Math.round(odo)) ? { odometerKm: odo, odometerAt: Date.now() } : {};
      if (vehicle) {
        await updateVehicle(vehicle.id, { ...patch, ...odoPatch });
        if (getMetricsVehicle()?.id === vehicle.id) setMetricsVehicle({ ...vehicle, ...patch, ...odoPatch });
      } else {
        const decoded = vin ? decodeVin(vin) : null;
        const v = await createVehicle({ ...patch, make: patch.make ?? decoded?.make ?? null, year: patch.year ?? decoded?.year ?? null, ...odoPatch });
        updateCarSettings({ activeVehicleId: v.id });
      }
      router.back();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!vehicle) return;
    Alert.alert(`Delete ${vehicle.name}?`, 'Its trips, performance runs, service log and reminders on this phone are deleted too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteVehicle(vehicle.id);
          detachVehicle(vehicle.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen footer={<Button title={vehicle ? 'Save' : 'Add car'} onPress={save} loading={saving} />}>
      <Stack.Screen options={{ title: vehicle ? 'Car details' : 'Add a car' }} />
      <TextField label="Name" value={form.name} onChangeText={set('name')} placeholder="Swift" maxLength={40} />
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField label="Make" value={form.make} onChangeText={set('make')} placeholder="Maruti Suzuki" />
        </View>
        <View style={styles.grow}>
          <TextField label="Model" value={form.model} onChangeText={set('model')} placeholder="Swift VXi" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField label="Year" value={form.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} />
        </View>
        <View style={styles.grow}>
          <TextField label="Odometer" value={form.odometerKm} onChangeText={set('odometerKm')} keyboardType="number-pad" suffix="km" />
        </View>
      </View>
      <Text variant="caption" tone="textMuted">
        Fuel
      </Text>
      <View style={styles.chips}>
        {FUELS.map((f) => (
          <Chip key={f} label={FUEL_LABEL[f]} selected={fuel === f} onPress={() => setFuel(f)} />
        ))}
      </View>
      <Text variant="label" tone="textMuted">
        For better estimates
      </Text>
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField label="Engine size" value={form.displacementL} onChangeText={set('displacementL')} keyboardType="decimal-pad" suffix="L" placeholder="1.2" />
        </View>
        <View style={styles.grow}>
          <TextField label="Kerb weight" value={form.weightKg} onChangeText={set('weightKg')} keyboardType="number-pad" suffix="kg" placeholder="900" />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.grow}>
          <TextField label="Redline" value={form.redlineRpm} onChangeText={set('redlineRpm')} keyboardType="number-pad" suffix="rpm" placeholder="6500" />
        </View>
        <View style={styles.grow}>
          <TextField label="Fuel tank" value={form.tankL} onChangeText={set('tankL')} keyboardType="decimal-pad" suffix="L" placeholder="37" />
        </View>
      </View>
      <Text variant="caption" tone="textMuted">
        Engine size improves fuel and power estimates on cars without a MAF sensor. Weight is used for power from acceleration. Redline sets the rev
        counter&apos;s red zone and the shift light.
      </Text>
      <TextField
        label="VIN"
        value={form.vin}
        onChangeText={set('vin')}
        autoCapitalize="characters"
        maxLength={17}
        hint={
          vehicle?.vin
            ? undefined
            : vehicle?.ecuInfo
              ? "This car didn't report its VIN. Many don't, especially older and Indian-market models. Type it from the RC or the windscreen if you like."
              : 'Filled in automatically if the car reports it'
        }
      />
      {vehicle?.ecuInfo?.calibrationIds.length ? (
        <Text variant="caption" tone="textSubtle">
          Engine software: {vehicle.ecuInfo.calibrationIds.join(', ')}
        </Text>
      ) : null}
      {vehicle && <Button title="Delete this car" variant="danger" onPress={confirmDelete} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
