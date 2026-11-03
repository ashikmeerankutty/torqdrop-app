import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { useCarSettings } from '@/lib/car-settings';
import { useDbQuery } from '@/lib/db/use-query';
import {
  addMaintenance,
  currentOdometer,
  deleteMaintenance,
  deleteReminder,
  formatDue,
  getVehicle,
  listMaintenance,
  listReminders,
  type Reminder,
  reminderStatus,
  saveReminder,
  SERVICE_LABEL,
  type ServiceKind,
} from '@/lib/garage/vehicles';

const KINDS = Object.keys(SERVICE_LABEL) as ServiceKind[];
const STATE_COLOR = { due: STATUS_COLOR.defect, soon: STATUS_COLOR.attention, ok: STATUS_COLOR.good, unknown: '#757575' };

export default function Maintenance() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const settings = useCarSettings();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const { data } = useDbQuery(
    async () => {
      const v = await getVehicle(id);
      const odo = v ? await currentOdometer(v) : null;
      return { v, odo, reminders: await listReminders(id), log: await listMaintenance(id) };
    },
    [id],
    ['reminders', 'maintenance', 'vehicles', 'trips'],
  );

  if (!data?.v) return <Screen>{null}</Screen>;
  const odo = data.odo;

  if (adding) return <AddEntry vehicleId={id} odometer={odo} onDone={() => setAdding(false)} />;
  if (editing) return <EditReminder reminder={editing} odometer={odo} onDone={() => setEditing(null)} />;

  const total = data.log.reduce((n, e) => n + (e.cost ?? 0), 0);

  return (
    <Screen footer={<Button title="Log a service or repair" icon="add" onPress={() => setAdding(true)} />}>
      <Stack.Screen options={{ title: `${data.v.name}: service` }} />
      {odo == null && (
        <Text tone="textMuted">Set the odometer in the car details so distance-based reminders can count down.</Text>
      )}
      <Text variant="label" tone="textMuted">
        Reminders
      </Text>
      <Card>
        {data.reminders.map((r, i) => {
          const s = reminderStatus(r, odo);
          return (
            <Pressable
              key={r.id}
              onPress={() => setEditing(r)}
              accessibilityRole="button"
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={[styles.dot, { backgroundColor: STATE_COLOR[s.state] }]} />
              <View style={styles.grow}>
                <Text variant="bodyStrong">{r.title}</Text>
                <Text variant="caption" tone="textMuted">
                  Every {[r.everyKm ? `${r.everyKm.toLocaleString()} km` : null, r.everyMonths ? `${r.everyMonths} months` : null].filter(Boolean).join(' or ')}
                  {s.state === 'unknown' ? ' · last service not set' : ` · ${formatDue(s.kmLeft, s.daysLeft)}`}
                </Text>
              </View>
              <Icon name="edit" size={16} tone="textSubtle" />
            </Pressable>
          );
        })}
        <Button
          title="Add a reminder"
          variant="ghost"
          icon="add"
          onPress={() => setEditing({ id: 0, vehicleId: id, kind: 'other', title: '', everyKm: 5000, everyMonths: 6, lastKm: odo, lastAt: Date.now() })}
        />
      </Card>

      <Text variant="label" tone="textMuted">
        History{total > 0 ? ` · ${settings.currency}${total.toLocaleString()} spent` : ''}
      </Text>
      {!data.log.length && <Text tone="textMuted">Nothing logged yet.</Text>}
      {data.log.map((e) => (
        <Card key={e.id}>
          <View style={styles.row}>
            <Icon name="wrench" size={18} tone="primary" />
            <View style={styles.grow}>
              <Text variant="bodyStrong">{e.title}</Text>
              <Text variant="caption" tone="textMuted">
                {new Date(e.at).toLocaleDateString()}
                {e.odometerKm != null ? ` · ${Math.round(e.odometerKm).toLocaleString()} km` : ''}
                {e.cost != null ? ` · ${settings.currency}${e.cost.toLocaleString()}` : ''}
              </Text>
            </View>
            <Pressable
              hitSlop={8}
              accessibilityLabel="Delete entry"
              onPress={() =>
                Alert.alert('Delete this entry?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => void deleteMaintenance(e.id) },
                ])
              }>
              <Icon name="delete" size={18} tone="textSubtle" />
            </Pressable>
          </View>
          {!!e.notes && (
            <Text variant="caption" tone="textMuted">
              {e.notes}
            </Text>
          )}
        </Card>
      ))}
    </Screen>
  );
}

const num = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function AddEntry({ vehicleId, odometer, onDone }: { vehicleId: string; odometer: number | null; onDone: () => void }) {
  const settings = useCarSettings();
  const [kind, setKind] = useState<ServiceKind>('service');
  const [title, setTitle] = useState('');
  const [odo, setOdo] = useState(odometer != null ? String(Math.round(odometer)) : '');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [daysAgo, setDaysAgo] = useState('0');

  async function save() {
    await addMaintenance({
      vehicleId,
      at: Date.now() - (num(daysAgo) ?? 0) * 86_400_000,
      odometerKm: num(odo),
      kind,
      title: title.trim() || SERVICE_LABEL[kind],
      cost: num(cost),
      notes: notes.trim() || null,
    });
    onDone();
  }

  return (
    <Screen footer={<Button title="Save" onPress={save} />}>
      <Stack.Screen options={{ title: 'Log work done' }} />
      <View style={styles.chips}>
        {KINDS.map((k) => (
          <Chip key={k} label={SERVICE_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      <TextField label="Description" value={title} onChangeText={setTitle} placeholder={SERVICE_LABEL[kind]} />
      <View style={styles.form}>
        <View style={styles.grow}>
          <TextField label="Odometer" value={odo} onChangeText={setOdo} keyboardType="number-pad" suffix="km" />
        </View>
        <View style={styles.grow}>
          <TextField label="Cost" value={cost} onChangeText={setCost} keyboardType="decimal-pad" prefix={settings.currency} />
        </View>
      </View>
      <TextField label="Days ago" value={daysAgo} onChangeText={setDaysAgo} keyboardType="number-pad" hint="0 for today" />
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Garage, parts used, oil grade…" />
      <Text variant="caption" tone="textMuted">
        Logging a service restarts the matching reminder. A general service also restarts the oil change reminder.
      </Text>
      <Button title="Cancel" variant="ghost" onPress={onDone} />
    </Screen>
  );
}

function EditReminder({ reminder, odometer, onDone }: { reminder: Reminder; odometer: number | null; onDone: () => void }) {
  const [title, setTitle] = useState(reminder.title);
  const [km, setKm] = useState(reminder.everyKm?.toString() ?? '');
  const [months, setMonths] = useState(reminder.everyMonths?.toString() ?? '');
  const [lastKm, setLastKm] = useState(reminder.lastKm != null ? String(Math.round(reminder.lastKm)) : '');
  const [lastDaysAgo, setLastDaysAgo] = useState(() =>
    reminder.lastAt != null ? String(Math.max(0, Math.round((Date.now() - reminder.lastAt) / 86_400_000))) : '',
  );

  async function save() {
    if (!title.trim()) return Alert.alert('Give the reminder a name');
    const d = num(lastDaysAgo);
    await saveReminder({
      ...reminder,
      id: reminder.id || undefined,
      title: title.trim(),
      everyKm: num(km) || null,
      everyMonths: num(months) || null,
      lastKm: num(lastKm),
      lastAt: d != null ? Date.now() - d * 86_400_000 : null,
    });
    onDone();
  }

  return (
    <Screen footer={<Button title="Save" onPress={save} />}>
      <Stack.Screen options={{ title: reminder.id ? 'Edit reminder' : 'New reminder' }} />
      <TextField label="Name" value={title} onChangeText={setTitle} />
      <View style={styles.form}>
        <View style={styles.grow}>
          <TextField label="Every" value={km} onChangeText={setKm} keyboardType="number-pad" suffix="km" />
        </View>
        <View style={styles.grow}>
          <TextField label="or every" value={months} onChangeText={setMonths} keyboardType="number-pad" suffix="months" />
        </View>
      </View>
      <Text variant="label" tone="textMuted">
        Last done
      </Text>
      <View style={styles.form}>
        <View style={styles.grow}>
          <TextField label="At" value={lastKm} onChangeText={setLastKm} keyboardType="number-pad" suffix="km" hint={odometer != null ? `Now ${Math.round(odometer).toLocaleString()} km` : undefined} />
        </View>
        <View style={styles.grow}>
          <TextField label="Days ago" value={lastDaysAgo} onChangeText={setLastDaysAgo} keyboardType="number-pad" />
        </View>
      </View>
      {reminder.id > 0 && (
        <Button
          title="Delete reminder"
          variant="danger"
          onPress={async () => {
            await deleteReminder(reminder.id);
            onDone();
          }}
        />
      )}
      <Button title="Cancel" variant="ghost" onPress={onDone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  form: { flexDirection: 'row', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
