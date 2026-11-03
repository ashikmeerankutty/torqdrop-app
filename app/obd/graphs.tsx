import { Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ScatterChart, TimeChart } from '@/components/gauges/Charts';
import { useMetricHistory } from '@/components/gauges/Sparkline';
import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { MetricPicker, useAvailableMetrics } from '@/components/obd/MetricPicker';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { shareCsv } from '@/lib/export-csv';
import { useObd } from '@/lib/obd/connection';
import { usePidDemand } from '@/lib/obd/live';
import { isDerived, metricDef, type MetricKey } from '@/lib/obd/metrics';
import { startRecording, stopRecording, useRecording } from '@/lib/obd/recorder';

const WINDOWS = [
  { label: '1 min', ms: 60_000 },
  { label: '5 min', ms: 5 * 60_000 },
  { label: '10 min', ms: 10 * 60_000 },
];
const MAX_SERIES = 4;

export default function Graphs() {
  const params = useLocalSearchParams<{ metrics?: string }>();
  const obd = useObd();
  const focused = useIsFocused();
  const available = useAvailableMetrics();
  const [mode, setMode] = useState<'time' | 'xy'>('time');
  const [keys, setKeys] = useState<MetricKey[]>(() => (params.metrics?.split(',') as MetricKey[] | undefined) ?? ['speed', 'rpm']);
  const [xy, setXy] = useState<{ x: MetricKey; y: MetricKey }>({ x: 'rpm', y: obd.supportedKeys.includes('map') ? 'boost' : 'engineLoad' });
  const [windowMs, setWindowMs] = useState(WINDOWS[0].ms);
  const [picking, setPicking] = useState<'add' | 'x' | 'y' | null>(null);
  const [width, setWidth] = useState(0);
  const recording = useRecording();

  const shown = mode === 'time' ? keys : [xy.x, xy.y];
  usePidDemand([...new Set(shown.flatMap((k) => metricDef(k).sources))], 250, focused && obd.status === 'connected');

  if (picking) {
    return (
      <>
        <Stack.Screen options={{ title: 'Choose a reading' }} />
        <MetricPicker
          available={available}
          onCancel={() => setPicking(null)}
          onPick={(k) => {
            if (picking === 'add') setKeys((ks) => (ks.includes(k) ? ks : [...ks, k].slice(-MAX_SERIES)));
            else setXy((p) => ({ ...p, [picking]: k }));
            setPicking(null);
          }}
        />
      </>
    );
  }

  async function toggleRecording() {
    if (!recording.active) return startRecording(shown);
    const out = stopRecording();
    if (!out || !out.rows.length) return;
    try {
      await shareCsv(`torqdrop-log-${new Date().toISOString().slice(0, 16)}`, out.header, out.rows);
    } catch (e) {
      Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen
      footer={
        obd.status === 'connected' && (
          <Button
            title={recording.active ? `Stop and export (${recording.rows} rows)` : 'Record these readings to CSV'}
            icon={recording.active ? 'stop' : 'record'}
            variant={recording.active ? 'primary' : 'secondary'}
            onPress={toggleRecording}
          />
        )
      }>
      <Stack.Screen options={{ title: 'Graphs' }} />
      {obd.status !== 'connected' && <Banner tone="info">Connect an adapter on the Drive tab to plot live readings.</Banner>}
      <View style={styles.chips}>
        <Chip label="Over time" selected={mode === 'time'} onPress={() => setMode('time')} />
        <Chip label="One against another" selected={mode === 'xy'} onPress={() => setMode('xy')} />
      </View>

      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.charts}>
        {mode === 'time' ? (
          <>
            <View style={styles.chips}>
              {WINDOWS.map((w) => (
                <Chip key={w.ms} label={w.label} selected={windowMs === w.ms} onPress={() => setWindowMs(w.ms)} />
              ))}
            </View>
            {width > 0 &&
              keys.map((k) => (
                <Card key={k}>
                  <SeriesChart metric={k} windowMs={windowMs} width={width - space.lg * 2 - 2} />
                  <Button title="Remove" variant="ghost" onPress={() => setKeys((ks) => ks.filter((x) => x !== k))} style={styles.remove} />
                </Card>
              ))}
            {keys.length < MAX_SERIES && <Button title="Add a reading" icon="add" variant="secondary" onPress={() => setPicking('add')} />}
          </>
        ) : (
          <>
            <View style={styles.chips}>
              <Chip label={`Across: ${metricDef(xy.x).short}`} selected={false} onPress={() => setPicking('x')} />
              <Chip label={`Up: ${metricDef(xy.y).short}`} selected={false} onPress={() => setPicking('y')} />
            </View>
            {width > 0 && (
              <Card>
                <XyChart x={xy.x} y={xy.y} width={width - space.lg * 2 - 2} />
              </Card>
            )}
            <Text variant="caption" tone="textMuted">
              Uses the last 10 minutes. Try boost against rpm on a turbo car, or timing advance against load.
            </Text>
          </>
        )}
      </View>
      {recording.active && (
        <Text variant="caption" tone="textMuted">
          Recording 4 times a second. It keeps going if you leave this screen; come back here to stop and export.
        </Text>
      )}
    </Screen>
  );
}

function SeriesChart({ metric, windowMs, width }: { metric: MetricKey; windowMs: number; width: number }) {
  const def = metricDef(metric);
  const points = useMetricHistory(metric, windowMs, 500);
  return (
    <TimeChart
      title={`${def.name}${def.estimate ? ' (est.)' : ''}`}
      unit={def.unit}
      decimals={def.decimals}
      points={points}
      width={width}
      windowMs={windowMs}
      min={metric === 'speed' || metric === 'rpm' ? 0 : undefined}
    />
  );
}

function XyChart({ x, y, width }: { x: MetricKey; y: MetricKey; width: number }) {
  const xs = useMetricHistory(x, 10 * 60_000, 1000);
  const ys = useMetricHistory(y, 10 * 60_000, 1000);
  const pairs = useMemo(() => {
    // Pair each Y reading with the X reading closest in time (within half a second).
    const out: { x: number; y: number }[] = [];
    let j = 0;
    for (const p of ys) {
      while (j < xs.length - 1 && Math.abs(xs[j + 1].t - p.t) <= Math.abs(xs[j].t - p.t)) j++;
      if (xs[j] && Math.abs(xs[j].t - p.t) < 500) out.push({ x: xs[j].v, y: p.v });
    }
    return out.slice(-1500);
  }, [xs, ys]);
  const [dx, dy] = [metricDef(x), metricDef(y)];
  if (isDerived(x) && isDerived(y) && pairs.length === 0) {
    return <Text tone="textMuted">Collecting readings…</Text>;
  }
  return <ScatterChart xLabel={dx.short} yLabel={dy.short} xDecimals={dx.decimals} yDecimals={dy.decimals} pairs={pairs} width={width} />;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  charts: { gap: space.md },
  remove: { alignSelf: 'flex-end', minHeight: 32, paddingVertical: 0 },
});
