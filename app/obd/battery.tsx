import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { addMaintenance } from '@/lib/garage/vehicles';
import { gradeBattery, type BatteryResult } from '@/lib/obd/battery-test';
import { useObd } from '@/lib/obd/connection';
import { live, usePidDemand, useLive } from '@/lib/obd/live';

type Step = 'intro' | 'resting' | 'crank' | 'idle' | 'load' | 'done';

const STEP_TEXT: Record<Exclude<Step, 'done'>, { title: string; body: string; action?: string }> = {
  intro: {
    title: 'Battery and charging test',
    body: 'Four short steps: battery at rest, while starting, charging at idle, and charging under load. Park somewhere safe with the handbrake on.',
    action: 'Begin: the engine is off',
  },
  resting: { title: 'Measuring the battery at rest…', body: 'Keep the engine off. If you just drove, the reading can be a little high.' },
  crank: { title: 'Start the engine now', body: 'Turn the key or press start. We record the lowest voltage while the starter turns.', action: "Skip: it won't start" },
  idle: { title: 'Measuring charging at idle…', body: 'Let the engine idle. Keep everything electrical switched off.' },
  load: {
    title: 'Switch on headlights, AC and the rear demister',
    body: 'Then hold the engine at about 1,500 rpm. Tap the button once everything is on.',
    action: 'Everything is on: measure',
  },
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Average battery voltage over `ms`. */
async function measure(ms: number): Promise<number | null> {
  const vals: number[] = [];
  const off = live.onSample((k, v) => {
    if (k === 'batteryVoltage' && typeof v === 'number') vals.push(v);
  });
  await sleep(ms);
  off();
  const a = avg(vals);
  return a == null ? null : Math.round(a * 100) / 100;
}

export default function BatteryTest() {
  const obd = useObd();
  const [step, setStep] = useState<Step>('intro');
  const [result, setResult] = useState<BatteryResult>({ resting: null, crankMin: null, idle: null, loaded: null });
  const cancelled = useRef(false);
  const voltage = useLive('batteryVoltage');
  const rpm = useLive('rpm');
  // Battery voltage as fast as possible while cranking; it dips for well under a second.
  usePidDemand(['batteryVoltage'], step === 'crank' ? 0 : 300, step !== 'intro' && step !== 'done');
  usePidDemand(['rpm'], 500, step !== 'intro' && step !== 'done');

  useEffect(() => () => void (cancelled.current = true), []);

  // Crank: track the minimum until the engine has run for 2 s (or 25 s pass).
  useEffect(() => {
    if (step !== 'crank') return;
    let min: number | null = null;
    let runningSince: number | null = null;
    const started = Date.now();
    const off = live.onSample((k, v) => {
      if (k === 'batteryVoltage' && typeof v === 'number' && v > 5) min = Math.min(min ?? v, v);
    });
    const id = setInterval(() => {
      const r = live.get('rpm');
      runningSince = typeof r === 'number' && r > 500 ? (runningSince ?? Date.now()) : null;
      if ((runningSince && Date.now() - runningSince > 2000) || Date.now() - started > 25_000) {
        clearInterval(id);
        off();
        setResult((x) => ({ ...x, crankMin: min }));
        setStep('idle');
      }
    }, 250);
    return () => {
      clearInterval(id);
      off();
    };
  }, [step]);

  useEffect(() => {
    if (step === 'resting') {
      void measure(3000).then((v) => {
        if (cancelled.current) return;
        setResult((x) => ({ ...x, resting: v }));
        setStep('crank');
      });
    }
    if (step === 'idle') {
      void sleep(3000)
        .then(() => measure(5000))
        .then((v) => {
          if (cancelled.current) return;
          setResult((x) => ({ ...x, idle: v }));
          setStep('load');
        });
    }
  }, [step]);

  async function measureLoad() {
    setStep('done');
    const v = await measure(6000);
    if (!cancelled.current) setResult((x) => ({ ...x, loaded: v }));
  }

  function begin() {
    if (!obd.simulated && typeof live.get('rpm') === 'number' && (live.get('rpm') as number) > 400) {
      Alert.alert('Engine is running', 'Switch the engine off (leave the ignition on if you like), then begin.');
      return;
    }
    setResult({ resting: null, crankMin: null, idle: null, loaded: null });
    setStep('resting');
  }

  async function saveToLog() {
    if (!obd.vehicleId) return;
    const lines = gradeBattery(result);
    await addMaintenance({
      vehicleId: obd.vehicleId,
      at: Date.now(),
      odometerKm: typeof obd.live.odometer === 'number' ? obd.live.odometer : null,
      kind: 'battery',
      title: 'Battery and charging test',
      cost: null,
      notes: lines.map((l) => `${l.label}: ${l.value != null ? `${l.value.toFixed(2)} V` : 'not measured'} (${l.note})`).join('\n'),
    });
    Alert.alert('Saved', 'The result is in the maintenance log for this car.');
  }

  if (obd.status !== 'connected') {
    return (
      <Screen>
        <Banner tone="info">Connect an adapter on the Drive tab first.</Banner>
      </Screen>
    );
  }

  const done = step === 'done';
  const lines = gradeBattery(result);
  const text = !done ? STEP_TEXT[step] : null;
  const measuringLoad = done && result.loaded == null;

  return (
    <Screen>
      {obd.simulated && <Banner tone="info" icon="play">The simulated car is always running, so these numbers are only a demo of the test.</Banner>}
      <Card>
        <View style={styles.row}>
          <Icon name="battery" size={28} tone="primary" />
          <View style={styles.grow}>
            <Text variant="caption" tone="textMuted">
              Battery now
            </Text>
            <Text variant="metric">
              {typeof voltage === 'number' ? voltage.toFixed(2) : '–'}
              <Text variant="caption" tone="textMuted">
                {' '}
                V{typeof rpm === 'number' ? ` · ${Math.round(rpm)} rpm` : ''}
              </Text>
            </Text>
          </View>
        </View>
      </Card>

      {text && (
        <Card highlighted>
          <Text variant="heading">{text.title}</Text>
          <Text tone="textMuted">{text.body}</Text>
          {step === 'intro' && <Button title={text.action!} onPress={begin} />}
          {step === 'crank' && <Button title={text.action!} variant="ghost" onPress={() => setStep('idle')} />}
          {step === 'load' && <Button title={text.action!} onPress={measureLoad} />}
        </Card>
      )}
      {measuringLoad && (
        <Card highlighted>
          <Text variant="heading">Measuring under load…</Text>
          <Text tone="textMuted">Keep everything switched on for a few more seconds.</Text>
        </Card>
      )}

      {(step !== 'intro' || result.resting != null) && (
        <Card>
          <Text variant="heading">Results</Text>
          {lines.map((l) => (
            <View key={l.key} style={styles.result}>
              <View style={styles.row}>
                <Icon
                  name={l.grade === 'good' ? 'check' : l.grade ? 'warning' : 'history'}
                  size={18}
                  color={l.grade ? STATUS_COLOR[l.grade] : undefined}
                  tone="textSubtle"
                />
                <Text variant="bodyStrong" style={styles.grow}>
                  {l.label}
                </Text>
                <Text variant="bodyStrong">{l.value != null ? `${l.value.toFixed(2)} V` : '–'}</Text>
              </View>
              {l.value != null && (
                <Text variant="caption" tone="textMuted">
                  {l.note}
                </Text>
              )}
            </View>
          ))}
        </Card>
      )}

      {done && !measuringLoad && (
        <>
          {obd.vehicleId && !obd.simulated && <Button title="Save to maintenance log" icon="wrench" onPress={saveToLog} />}
          <Button title="Run again" variant="secondary" onPress={() => setStep('intro')} />
          <Button title="Done" variant="ghost" onPress={() => router.back()} />
        </>
      )}
      <Text variant="caption" tone="textSubtle">
        Voltage is measured by the adapter at the OBD port, which is close to the battery on most cars. A load test at a battery shop is the definitive
        check.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  result: { gap: 2, paddingVertical: space.xs },
});
