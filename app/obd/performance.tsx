import { useKeepAwake } from 'expo-keep-awake';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TimeChart } from '@/components/gauges/Charts';
import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { useDbQuery } from '@/lib/db/use-query';
import { bestRuns, saveRun } from '@/lib/garage/runs';
import { useObd } from '@/lib/obd/connection';
import { live, usePidDemand, useLive } from '@/lib/obd/live';
import { useMetricsVehicle } from '@/lib/obd/metrics';
import { PERF_TESTS, PerfRun, type PerfState, type PerfType } from '@/lib/obd/performance';

const TYPES = Object.keys(PERF_TESTS) as PerfType[];
/** Driver and a passenger's worth of fuel and kit on top of the kerb weight. */
const PAYLOAD_KG = 90;

export default function Performance() {
  useKeepAwake();
  const { colors } = useTheme();
  const obd = useObd();
  const focused = useIsFocused();
  const vehicle = useMetricsVehicle();
  const [type, setType] = useState<PerfType>('zero100');
  const [state, setState] = useState<PerfState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [chartWidth, setChartWidth] = useState(0);
  const runRef = useRef<PerfRun | null>(null);
  const speed = useLive('speed');
  const connected = obd.status === 'connected';
  // Speed only, as fast as the adapter allows: everything else waits while timing.
  usePidDemand(['speed'], 0, focused && connected);
  const vehicleId = obd.vehicleId ?? null;
  const { data: board } = useDbQuery(() => bestRuns(vehicleId, type), [vehicleId, type], ['runs']);

  useEffect(() => {
    if (!connected) return;
    const run = new PerfRun(type, vehicle?.weightKg ? vehicle.weightKg + PAYLOAD_KG : null);
    runRef.current = run;
    let saved = false;
    const off = live.onSample((k, v, t) => {
      if (k !== 'speed' || typeof v !== 'number') return;
      const s = run.feed({ t, v });
      setState(s);
      if (s.phase === 'done' && s.result && !saved) {
        saved = true;
        void saveRun(vehicleId, type, s.result, obd.simulated);
      }
    });
    // Tick the elapsed time between readings.
    const id = setInterval(() => setState((s) => (s?.phase === 'running' ? { ...s, elapsedS: s.elapsedS + 0.1 } : s)), 100);
    return () => {
      off();
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, attempt, connected, vehicle?.weightKg]);

  if (!connected) {
    return (
      <Screen>
        <Banner tone="info">Connect an adapter on the Drive tab first.</Banner>
      </Screen>
    );
  }

  const phase = state?.phase ?? 'waiting';
  const phaseColor = phase === 'armed' ? STATUS_COLOR.good : phase === 'aborted' ? STATUS_COLOR.defect : phase === 'running' ? colors.primary : colors.textMuted;
  const result = state?.result;

  return (
    <Screen>
      <Banner tone="warning" title="Only on a closed road or track">
        Public roads are not for speed tests. Set up the test before you drive, keep both hands on the wheel, and don&apos;t look at the phone while timing.
      </Banner>
      <View style={styles.chips}>
        {TYPES.map((t) => (
          <Chip
            key={t}
            label={PERF_TESTS[t].short}
            selected={type === t}
            onPress={() => {
              setState(null);
              setType(t);
            }}
          />
        ))}
      </View>
      <Text variant="caption" tone="textMuted">
        {PERF_TESTS[type].how}
      </Text>

      <Card accent={phaseColor}>
        <Text variant="label" style={{ color: phaseColor }}>
          {state?.message ?? 'Waiting for speed readings…'}
        </Text>
        <View style={styles.big}>
          <Text style={[styles.time, { color: colors.text }]}>
            {phase === 'running' || phase === 'done' ? (state?.elapsedS ?? 0).toFixed(phase === 'done' ? 2 : 1) : '0.0'}
            <Text variant="heading" tone="textMuted">
              {' '}
              s
            </Text>
          </Text>
          <Text variant="heading" tone="textMuted">
            {typeof speed === 'number' ? Math.round(speed) : '–'} km/h
          </Text>
        </View>
        {result && (
          <View style={styles.stats}>
            <Stat label="Distance" value={`${result.distanceM.toFixed(0)} m`} />
            <Stat label={type === 'quarter' ? 'Trap speed' : 'End speed'} value={`${result.endSpeed} km/h`} />
            <Stat label="Peak power" value={result.peakHp != null ? `~${result.peakHp} hp` : 'Add weight'} />
          </View>
        )}
        {(phase === 'done' || phase === 'aborted') && <Button
            title="Run again"
            onPress={() => {
              setState(null);
              setAttempt((a) => a + 1);
            }}
          />}
      </Card>

      {result && result.samples.length > 2 && (
        <Card>
          <View onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)} />
          {chartWidth > 0 && <TimeChart
            title="Speed during the run"
            unit="km/h"
            decimals={0}
            points={result.samples}
            width={chartWidth}
            windowMs={result.samples[result.samples.length - 1].t - result.samples[0].t}
            relative="start"
            min={0}
          />}
        </Card>
      )}

      <Card>
        <Text variant="heading">Best {PERF_TESTS[type].label}</Text>
        {!board?.length && <Text tone="textMuted">No runs yet.</Text>}
        {board?.map((r, i) => (
          <View key={r.id} style={styles.row}>
            <Text variant="bodyStrong" style={styles.rank}>
              {i + 1}
            </Text>
            <Text variant="bodyStrong" style={styles.grow}>
              {r.timeS.toFixed(2)} s
            </Text>
            <Text variant="caption" tone="textMuted">
              {r.simulated ? 'Simulated · ' : ''}
              {new Date(r.at).toLocaleDateString()}
            </Text>
          </View>
        ))}
        <Text variant="caption" tone="textSubtle">
          Timed from OBD speed, which updates a few times a second, so results are within about 0.2 s. Power is an estimate from acceleration and
          the car&apos;s weight{vehicle?.weightKg ? '' : ' (set it in Garage → car details)'}.
        </Text>
      </Card>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="caption" tone="textMuted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  big: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  time: { fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rank: { width: 20 },
  grow: { flex: 1 },
});
