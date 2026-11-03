import { router, useIsFocused } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatMetric, warnColor } from '@/components/gauges/GaugeTile';
import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { useObd } from '@/lib/obd/connection';
import { type LiveKey, usePidDemand } from '@/lib/obd/live';
import { DERIVED_KEYS, metricDef, type MetricKey, redlineRpm, useMetric, useMetricsVehicle } from '@/lib/obd/metrics';
import { CATEGORY_LABEL, type PidCategory, PID_KEYS, PIDS } from '@/lib/obd/pid-decoder';

const ORDER: PidCategory[] = ['engine', 'fuel', 'temperature', 'air', 'electrical', 'emissions', 'diesel', 'distance'];

/** Every reading the connected car supports, refreshed every couple of seconds. */
export default function Sensors() {
  const { colors } = useTheme();
  const obd = useObd();
  const focused = useIsFocused();
  const [showMissing, setShowMissing] = useState(false);
  const supported = obd.supportedKeys;
  const keys: LiveKey[] = [...supported, 'batteryVoltage'];
  // About 40 values at 2.5 s each keeps the adapter at ~16 requests a second.
  usePidDemand(keys, 2500, focused && obd.status === 'connected');
  const missing = PID_KEYS.filter((k) => !supported.includes(k));

  if (obd.status !== 'connected') {
    return (
      <Screen>
        <Banner tone="info">Connect an adapter on the Drive tab to see live readings.</Banner>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text tone="textMuted">
        This car reports {supported.length} standard readings. Tap one to plot it.
      </Text>
      {ORDER.map((cat) => {
        const group: MetricKey[] = [...supported.filter((k) => PIDS[k].category === cat), ...(cat === 'electrical' ? (['batteryVoltage'] as const) : [])];
        if (!group.length) return null;
        return (
          <View key={cat} style={styles.group}>
            <Text variant="label" tone="textMuted">
              {CATEGORY_LABEL[cat]}
            </Text>
            <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {group.map((k, i) => (
                <SensorRow key={k} metric={k} first={i === 0} />
              ))}
            </View>
          </View>
        );
      })}
      <View style={styles.group}>
        <Text variant="label" tone="textMuted">
          Worked out from other readings
        </Text>
        <View style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {DERIVED_KEYS.map((k, i) => (
            <SensorRow key={k} metric={k} first={i === 0} />
          ))}
        </View>
      </View>
      <Pressable onPress={() => setShowMissing((s) => !s)} accessibilityRole="button">
        <Text variant="caption" tone="tint">
          {showMissing ? 'Hide' : 'Show'} the {missing.length} readings this car doesn&apos;t report
        </Text>
      </Pressable>
      {showMissing && (
        <Text variant="caption" tone="textSubtle">
          {missing.map((k) => PIDS[k].name).join(' · ')}
        </Text>
      )}
    </Screen>
  );
}

function SensorRow({ metric, first }: { metric: MetricKey; first: boolean }) {
  const { colors } = useTheme();
  const v = useMetric(metric);
  const vehicle = useMetricsVehicle();
  const def = metricDef(metric);
  const warn = typeof v === 'number' ? warnColor(metric, v, redlineRpm(vehicle)) : undefined;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/obd/graphs', params: { metrics: metric } })}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
        pressed && { backgroundColor: colors.surfaceRaised },
      ]}>
      <Text style={styles.name} numberOfLines={2}>
        {def.name}
        {def.estimate ? <Text variant="caption" tone="textSubtle"> est.</Text> : null}
      </Text>
      <Text variant="bodyStrong" style={[styles.value, warn ? { color: warn } : undefined]}>
        {formatMetric(metric, v)}
      </Text>
      <Text variant="caption" tone="textMuted" style={styles.unit}>
        {def.unit}
      </Text>
      <Icon name="chart" size={16} tone="textSubtle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  list: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 48 },
  name: { flex: 1, paddingVertical: space.sm },
  value: { fontVariant: ['tabular-nums'], textAlign: 'right' },
  unit: { width: 44 },
});
