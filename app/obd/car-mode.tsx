import { useKeepAwake } from 'expo-keep-awake';
import { router, Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnalogGauge } from '@/components/gauges/AnalogGauge';
import { formatMetric } from '@/components/gauges/GaugeTile';
import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Icon, type IconName } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';
import { updateCarSettings, useCarSettings } from '@/lib/car-settings';
import { useDriveAlerts } from '@/lib/obd/alerts';
import { useObd } from '@/lib/obd/connection';
import { usePidDemand } from '@/lib/obd/live';
import { metricDef, type MetricKey, redlineRpm, useMetric, useMetricsVehicle } from '@/lib/obd/metrics';

const HUD_GREEN = '#39FF88';

/**
 * Full-screen landscape dashboard for a phone mount. HUD mode switches to a single huge speed readout
 * in green on black, optionally mirrored so it reads correctly reflected in the windscreen at night.
 */
export default function CarMode() {
  useKeepAwake();
  const { colors } = useTheme();
  const obd = useObd();
  const settings = useCarSettings();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [hud, setHud] = useState(false);

  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  usePidDemand(['speed', 'rpm'], 80);
  usePidDemand(['coolantTemp', 'moduleVoltage', 'fuelLevel'], 2000);

  const landscape = width > height;
  const bg = hud ? '#000' : colors.background;
  const mirror = hud && settings.hudMirror;

  return (
    <View style={[styles.root, { backgroundColor: bg, paddingLeft: insets.left + space.md, paddingRight: insets.right + space.md }]}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      <StatusBar hidden />
      <View style={[styles.flex, mirror && { transform: [{ scaleX: -1 }] }]}>
        <ShiftLight hud={hud} />
        <Alerts />
        {obd.status !== 'connected' ? (
          <View style={styles.center}>
            <Text tone="textMuted">Not connected. Connect an adapter from the Drive tab.</Text>
          </View>
        ) : hud ? (
          <HudView height={height} />
        ) : (
          <DialView width={width - insets.left - insets.right - space.md * 2} height={height} landscape={landscape} />
        )}
      </View>
      <View style={[styles.controls, { bottom: insets.bottom + space.sm }]}>
        <ControlButton icon="close" label="Exit" onPress={() => router.back()} hud={hud} />
        <ControlButton icon="drive" label={hud ? 'Gauges' : 'HUD'} onPress={() => setHud((h) => !h)} hud={hud} />
        {hud && (
          <ControlButton
            icon="mirror"
            label={settings.hudMirror ? 'Unmirror' : 'Mirror'}
            onPress={() => updateCarSettings({ hudMirror: !settings.hudMirror })}
            hud={hud}
          />
        )}
      </View>
    </View>
  );
}

function DialView({ width, height, landscape }: { width: number; height: number; landscape: boolean }) {
  const vehicle = useMetricsVehicle();
  const redline = redlineRpm(vehicle);
  const speed = useMetric('speed');
  const rpm = useMetric('rpm');
  const size = landscape ? Math.min(height - 70, (width - 180) / 2) : Math.min(width - 20, (height - 260) / 2);
  const rpmMax = Math.ceil((redline + 1000) / 1000) * 1000;
  return (
    <View style={[styles.dials, !landscape && { flexDirection: 'column' }]}>
      <AnalogGauge value={speed} min={0} max={220} size={size} label="Speed" unit="km/h" decimals={0} />
      <View style={styles.middle}>
        <Readout metric="gear" big />
        <Readout metric="coolantTemp" />
        <Readout metric="moduleVoltage" />
        <Readout metric="fuelLevel" />
      </View>
      <AnalogGauge value={rpm} min={0} max={rpmMax} size={size} label="Engine" unit="rpm" decimals={0} redFrom={redline} />
    </View>
  );
}

function Readout({ metric, big }: { metric: MetricKey; big?: boolean }) {
  const v = useMetric(metric);
  const def = metricDef(metric);
  if (v === null) return null;
  return (
    <View style={styles.readout}>
      <Text style={[styles.readoutValue, big && { fontSize: 56 }]}>{formatMetric(metric, v)}</Text>
      <Text variant="caption" tone="textMuted">
        {def.short}
        {def.unit ? ` · ${def.unit}` : ''}
      </Text>
    </View>
  );
}

function HudView({ height }: { height: number }) {
  const speed = useMetric('speed');
  const rpm = useMetric('rpm');
  const gear = useMetric('gear');
  return (
    <View style={styles.center}>
      <Text style={[styles.hudSpeed, { fontSize: Math.min(height * 0.55, 260) }]}>{typeof speed === 'number' ? Math.round(speed) : '–'}</Text>
      <Text style={styles.hudSub}>
        km/h · {typeof rpm === 'number' ? Math.round(rpm) : '–'} rpm{typeof gear === 'number' ? ` · ${gear === 0 ? 'N' : `gear ${gear}`}` : ''}
      </Text>
    </View>
  );
}

const LEDS = 10;

/** Row of lights that fills from 60 % of the shift point and flashes at it. */
function ShiftLight({ hud }: { hud: boolean }) {
  const { colors } = useTheme();
  const settings = useCarSettings();
  const vehicle = useMetricsVehicle();
  const rpm = useMetric('rpm');
  const shift = settings.alerts.shiftRpm || Math.round(redlineRpm(vehicle) * 0.9);
  const [blink, setBlink] = useState(false);
  const over = typeof rpm === 'number' && rpm >= shift;
  useEffect(() => {
    if (!over) return;
    const id = setInterval(() => setBlink((b) => !b), 120);
    return () => clearInterval(id);
  }, [over]);
  const lit = typeof rpm === 'number' ? Math.round(((rpm - shift * 0.6) / (shift * 0.4)) * LEDS) : 0;
  return (
    <View style={styles.leds} accessibilityLabel={over ? 'Shift now' : undefined}>
      {Array.from({ length: LEDS }, (_, i) => {
        const on = over ? blink : i < lit;
        const color = i < LEDS * 0.5 ? STATUS_COLOR.good : i < LEDS * 0.8 ? STATUS_COLOR.attention : STATUS_COLOR.defect;
        return <View key={i} style={[styles.led, { backgroundColor: on ? color : hud ? '#111' : colors.surfaceRaised }]} />;
      })}
    </View>
  );
}

function Alerts() {
  const alerts = useDriveAlerts();
  if (!alerts.length) return null;
  const a = alerts[0];
  return (
    <View style={[styles.alert, { backgroundColor: a.severity === 'danger' ? STATUS_COLOR.defect : STATUS_COLOR.attention }]}>
      <Icon name="warning" size={20} color="#fff" />
      <Text style={styles.alertText} numberOfLines={1}>
        {a.title}
      </Text>
    </View>
  );
}

function ControlButton({ icon, label, onPress, hud }: { icon: IconName; label: string; onPress: () => void; hud: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.control, { backgroundColor: pressed ? colors.surfaceRaised : hud ? '#111' : colors.surface, borderColor: colors.border }]}>
      <Icon name={icon} size={18} color={hud ? HUD_GREEN : colors.text} />
      <Text variant="caption" style={{ color: hud ? HUD_GREEN : colors.text, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: space.sm },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dials: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  middle: { alignItems: 'center', gap: space.md, minWidth: 140 },
  readout: { alignItems: 'center' },
  readoutValue: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hudSpeed: { color: HUD_GREEN, fontWeight: '900', fontVariant: ['tabular-nums'], includeFontPadding: false },
  hudSub: { color: HUD_GREEN, fontSize: 22, fontWeight: '700', opacity: 0.85 },
  leds: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: space.xs },
  led: { width: 28, height: 10, borderRadius: 5 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 6, alignSelf: 'center' },
  alertText: { color: '#fff', fontWeight: '700' },
  controls: { position: 'absolute', right: space.lg, flexDirection: 'row', gap: space.sm },
  control: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, minHeight: 40 },
});
