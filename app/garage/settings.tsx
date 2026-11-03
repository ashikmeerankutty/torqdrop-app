import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { space } from '@/constants/Theme';
import { updateCarSettings, useCarSettings } from '@/lib/car-settings';

/** A number field that saves on blur, so typing "1" on the way to "105" doesn't fire alerts. */
function NumberSetting({ label, value, suffix, prefix, onSave, hint }: { label: string; value: number; suffix?: string; prefix?: string; onSave: (n: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <TextField
      label={label}
      value={text}
      onChangeText={setText}
      keyboardType="decimal-pad"
      suffix={suffix}
      prefix={prefix}
      hint={hint}
      onBlur={() => {
        const n = parseFloat(text);
        if (Number.isFinite(n) && n >= 0) onSave(n);
        else setText(String(value));
      }}
    />
  );
}

function Toggle({ label, body, value, onChange }: { label: string; body?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={styles.grow}>
        <Text variant="bodyStrong">{label}</Text>
        {body && (
          <Text variant="caption" tone="textMuted">
            {body}
          </Text>
        )}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

export default function CarSettingsScreen() {
  const s = useCarSettings();
  const [gpsGranted, setGpsGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((p) => setGpsGranted(p.granted));
  }, []);

  async function setGps(on: boolean) {
    if (on && !gpsGranted) {
      const p = await Location.requestForegroundPermissionsAsync();
      setGpsGranted(p.granted);
      if (!p.granted) {
        Alert.alert('Location is off for TorqDrop', 'Allow location in the phone settings to draw trip routes.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open settings', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
    }
    updateCarSettings({ tripGps: on });
  }

  return (
    <Screen>
      <Text variant="label" tone="textMuted">
        Trips
      </Text>
      <Card>
        <Toggle
          label="Record trips automatically"
          body="While an adapter is connected and the app is open. Trips under 200 m aren't kept."
          value={s.autoTrips}
          onChange={(v) => updateCarSettings({ autoTrips: v })}
        />
        <Toggle
          label="Draw the route with GPS"
          body="Uses the phone's location only while recording a trip. Routes stay on this phone."
          value={s.tripGps && !!gpsGranted}
          onChange={setGps}
        />
        <Text variant="caption" tone="textSubtle">
          Changes to trip recording apply from the next connection.
        </Text>
      </Card>

      <Text variant="label" tone="textMuted">
        Fuel
      </Text>
      <Card>
        <View style={styles.row}>
          <View style={styles.grow}>
            <NumberSetting label="Fuel price per litre" value={s.fuelPrice} prefix={s.currency} onSave={(n) => updateCarSettings({ fuelPrice: n })} />
          </View>
          <View style={styles.currency}>
            <TextField label="Currency" value={s.currency} onChangeText={(c) => updateCarSettings({ currency: c.slice(0, 3) })} maxLength={3} />
          </View>
        </View>
        <View style={styles.chips}>
          <Chip label="km/L" selected={s.economyUnit === 'kmpl'} onPress={() => updateCarSettings({ economyUnit: 'kmpl' })} />
          <Chip label="L/100 km" selected={s.economyUnit === 'l100km'} onPress={() => updateCarSettings({ economyUnit: 'l100km' })} />
        </View>
      </Card>

      <Text variant="label" tone="textMuted">
        Driving alerts
      </Text>
      <Card>
        <Toggle label="Show alerts while driving" value={s.alerts.enabled} onChange={(v) => updateCarSettings({ alerts: { enabled: v } })} />
        <Toggle label="Vibrate on a new alert" value={s.alerts.vibrate} onChange={(v) => updateCarSettings({ alerts: { vibrate: v } })} />
        <NumberSetting
          label="Engine hot above"
          value={s.alerts.coolantC}
          suffix="°C"
          onSave={(n) => updateCarSettings({ alerts: { coolantC: n } })}
          hint="Most engines run at 85–105 °C."
        />
        <NumberSetting label="Low charging voltage below" value={s.alerts.lowVoltage} suffix="V" onSave={(n) => updateCarSettings({ alerts: { lowVoltage: n } })} />
        <NumberSetting
          label="Speed alert above"
          value={s.alerts.overspeedKmh}
          suffix="km/h"
          onSave={(n) => updateCarSettings({ alerts: { overspeedKmh: n } })}
          hint="0 turns it off."
        />
        <NumberSetting
          label="Shift light at"
          value={s.alerts.shiftRpm}
          suffix="rpm"
          onSave={(n) => updateCarSettings({ alerts: { shiftRpm: n } })}
          hint="0 uses 90 % of the car's redline."
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', gap: space.sm },
  currency: { width: 90 },
  chips: { flexDirection: 'row', gap: space.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
});
