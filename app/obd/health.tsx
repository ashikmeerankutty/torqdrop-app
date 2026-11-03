import { router, useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { DtcList } from '@/components/obd/DtcList';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { readFreezeFrame, readMode06, readPermanentCodes, useObd } from '@/lib/obd/connection';
import { computeHealth, tamperFlags } from '@/lib/obd/health';
import { usePidDemand } from '@/lib/obd/live';
import { type Mode06Test, decodeVin, vinCheckDigitValid } from '@/lib/obd/modes';
import { PIDS, type PidKey } from '@/lib/obd/pid-decoder';
import type { FreezeFrame } from '@/lib/obd/session';

type Load<T> = { state: 'idle' | 'loading' | 'done' | 'error'; data?: T; error?: string };

function useRead<T>(fn: () => Promise<T>, auto: boolean): [Load<T>, () => void] {
  const [s, setS] = useState<Load<T>>({ state: auto ? 'loading' : 'idle' });
  const load = () =>
    fn()
      .then((data) => setS({ state: 'done', data }))
      .catch((e) => setS({ state: 'error', error: e instanceof Error ? e.message : String(e) }));
  const run = () => {
    setS({ state: 'loading' });
    void load();
  };
  useEffect(() => {
    if (auto) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);
  return [s, run];
}

export default function Health() {
  const { colors } = useTheme();
  const obd = useObd();
  const focused = useIsFocused();
  const connected = obd.status === 'connected';
  usePidDemand(['distanceSinceClear', 'warmUpsSinceClear', 'timeSinceClear', 'distanceWithMil', 'timeWithMil'], 10_000, focused && connected);
  const [permanent] = useRead(readPermanentCodes, connected);
  const [freeze, readFreeze] = useRead<FreezeFrame | null>(readFreezeFrame, connected);
  const [mode06, runMode06] = useRead<Mode06Test[] | null>(readMode06, false);

  if (!connected) {
    return (
      <Screen>
        <Banner tone="info">Connect an adapter on the Drive tab to run a health check.</Banner>
      </Screen>
    );
  }

  const stored = obd.dtcs?.stored ?? [];
  const pending = obd.dtcs?.pending ?? [];
  const health = computeHealth({
    milOn: obd.mil?.milOn ?? false,
    stored,
    pending,
    permanent: permanent.data ?? null,
    readiness: obd.readiness ?? null,
    mode06: mode06.data ?? null,
    ltft: obd.live.longFuelTrim1,
    stft: obd.live.shortFuelTrim1,
    runningVoltage: (obd.live.rpm ?? 0) > 500 ? (obd.live.moduleVoltage ?? obd.live.batteryVoltage) : null,
    coolant: obd.live.coolantTemp,
  });
  const flags = tamperFlags({
    readiness: obd.readiness ?? null,
    distanceSinceClear: obd.live.distanceSinceClear,
    warmUpsSinceClear: obd.live.warmUpsSinceClear,
    timeSinceClear: obd.live.timeSinceClear,
    distanceWithMil: obd.live.distanceWithMil,
  });
  const scoreColor = health.score >= 90 ? STATUS_COLOR.good : health.score >= 70 ? STATUS_COLOR.acceptable : health.score >= 45 ? STATUS_COLOR.attention : STATUS_COLOR.defect;
  const extraPermanent = (permanent.data ?? []).filter((c) => !stored.includes(c));
  const vin = obd.info?.vin;
  const decoded = vin ? decodeVin(vin) : null;

  return (
    <Screen>
      {obd.simulated && <Banner tone="info" icon="play">Demo data from a simulated car.</Banner>}

      <Card accent={scoreColor}>
        <View style={styles.row}>
          <View style={[styles.score, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreText, { color: scoreColor }]}>{health.score}</Text>
          </View>
          <View style={styles.grow}>
            <Text variant="heading">{health.verdict}</Text>
            <Text variant="caption" tone="textMuted">
              Health score from codes, self-tests, fuel trims and charging. Standard OBD can&apos;t see brakes, suspension, ABS, airbags or body.
            </Text>
          </View>
        </View>
        {health.factors.map((f) => (
          <View key={f.label} style={styles.row}>
            <Icon name={f.tone === 'defect' ? 'error' : 'warning'} size={16} color={STATUS_COLOR[f.tone]} />
            <Text variant="caption" style={styles.grow}>
              {f.label}
            </Text>
            <Text variant="caption" tone="textMuted">
              −{f.points}
            </Text>
          </View>
        ))}
      </Card>

      {flags.length > 0 && (
        <Card accent={STATUS_COLOR.attention}>
          <Text variant="label" tone="textMuted">
            Buying this car? Ask about these
          </Text>
          {flags.map((f) => (
            <View key={f.id} style={styles.flag}>
              <Text variant="bodyStrong">{f.title}</Text>
              <Text variant="caption" tone="textMuted">
                {f.body}
              </Text>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <Text variant="heading">Readiness monitors</Text>
        <Text variant="caption" tone="textMuted">
          The engine computer&apos;s own emissions self-tests. Unfinished tests are normal for a few days after codes are cleared or the battery is
          disconnected.
        </Text>
        {obd.readiness ? (
          obd.readiness.monitors.map((m) => (
            <View key={m.key} style={styles.row}>
              <Icon name={m.complete ? 'check' : 'history'} size={18} color={m.complete ? STATUS_COLOR.good : STATUS_COLOR.attention} />
              <Text style={styles.grow}>{m.name}</Text>
              <Text variant="caption" style={{ color: m.complete ? STATUS_COLOR.good : STATUS_COLOR.attention, fontWeight: '700' }}>
                {m.complete ? 'Complete' : 'Not finished'}
              </Text>
            </View>
          ))
        ) : (
          <Text tone="textMuted">Reading…</Text>
        )}
        <DistanceFacts live={obd.live} />
      </Card>

      <Card>
        <Text variant="heading">Trouble codes</Text>
        {obd.dtcs ? <DtcList stored={stored} pending={pending} /> : <Text tone="textMuted">Reading…</Text>}
        {permanent.state === 'done' && (
          <Text variant="caption" tone="textMuted">
            {extraPermanent.length
              ? `Permanent codes: ${extraPermanent.join(', ')}. These were stored recently and clear themselves once the car confirms the fault is gone.`
              : (permanent.data?.length ?? 0) > 0
                ? `Permanent codes match the stored codes (${permanent.data!.join(', ')}). They can't be cleared with a scan tool.`
                : 'No permanent codes.'}
          </Text>
        )}
        {(stored.length > 0 || pending.length > 0 || extraPermanent.length > 0) && (
          <Button
            title="Explain these codes"
            icon="ai"
            onPress={() => router.push({ pathname: '/diagnose', params: { codes: [...new Set([...stored, ...pending, ...extraPermanent])].join(',') } })}
          />
        )}
      </Card>

      <Card>
        <View style={styles.row}>
          <Text variant="heading" style={styles.grow}>
            Freeze frame
          </Text>
          <Button title="Read again" variant="ghost" onPress={readFreeze} style={styles.compact} />
        </View>
        {freeze.state === 'loading' && <Text tone="textMuted">Reading…</Text>}
        {freeze.state === 'error' && <Text tone="danger">{freeze.error}</Text>}
        {freeze.state === 'done' && !freeze.data && <Text tone="textMuted">No freeze frame stored. One is saved when a code is set.</Text>}
        {freeze.data && (
          <>
            <Text variant="caption" tone="textMuted">
              What the engine was doing when {freeze.data.dtc} was set:
            </Text>
            <View style={[styles.table, { borderColor: colors.border }]}>
              {(Object.entries(freeze.data.values) as [PidKey, number][]).map(([k, v]) => (
                <View key={k} style={styles.tableRow}>
                  <Text variant="caption" style={styles.grow}>
                    {PIDS[k].name}
                  </Text>
                  <Text variant="caption" style={styles.mono}>
                    {v.toFixed(PIDS[k].decimals)} {PIDS[k].unit}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      <Card>
        <Text variant="heading">On-board self-test results</Text>
        <Text variant="caption" tone="textMuted">
          Detailed results of the tests behind the readiness monitors (Mode 06). These can show a misfire or a weak catalytic converter before a code is
          set. Takes about 10 seconds.
        </Text>
        {mode06.state !== 'done' && (
          <Button title={mode06.state === 'loading' ? 'Reading…' : 'Run self-test report'} loading={mode06.state === 'loading'} variant="secondary" onPress={runMode06} />
        )}
        {mode06.state === 'error' && <Text tone="danger">{mode06.error}</Text>}
        {mode06.state === 'done' && !mode06.data?.length && <Text tone="textMuted">This car doesn&apos;t report self-test results over standard OBD.</Text>}
        {mode06.data && mode06.data.length > 0 && <Mode06List tests={mode06.data} />}
      </Card>

      <Card>
        <Text variant="heading">Vehicle information</Text>
        <InfoRow label="VIN" value={vin ?? 'Not reported (common on older cars)'} />
        {decoded?.make && <InfoRow label="Maker (from VIN)" value={decoded.make} />}
        {decoded?.year && <InfoRow label="Model year (from VIN)" value={String(decoded.year)} />}
        {vin && !vinCheckDigitValid(vin) && (
          <Text variant="caption" tone="textSubtle">
            The VIN check digit doesn&apos;t match. That&apos;s normal for many cars built outside North America; compare the VIN with the RC and the
            chassis plate.
          </Text>
        )}
        {obd.info?.fuelType && <InfoRow label="Fuel (reported)" value={obd.info.fuelType} />}
        {obd.info?.ecuName && <InfoRow label="Engine computer" value={obd.info.ecuName} />}
        {obd.info?.calibrationIds.map((id, i) => <InfoRow key={id} label={i ? '' : 'Software (calibration ID)'} value={id} />)}
        <InfoRow label="OBD protocol" value={obd.protocol ? `ELM327 protocol ${obd.protocol}` : 'Unknown'} />
        <InfoRow label="Readings supported" value={String(obd.supportedKeys.length)} />
      </Card>
    </Screen>
  );
}

function DistanceFacts({ live }: { live: ReturnType<typeof useObd>['live'] }) {
  const facts: [string, string][] = [];
  if (typeof live.distanceSinceClear === 'number') facts.push(['Distance since codes cleared', `${Math.round(live.distanceSinceClear)} km`]);
  if (typeof live.warmUpsSinceClear === 'number') facts.push(['Warm-ups since codes cleared', String(live.warmUpsSinceClear)]);
  if (typeof live.timeSinceClear === 'number') facts.push(['Engine time since codes cleared', `${Math.round(live.timeSinceClear / 60)} h`]);
  if (typeof live.distanceWithMil === 'number') facts.push(['Distance with check-engine light on', `${Math.round(live.distanceWithMil)} km`]);
  return (
    <>
      {facts.map(([l, v]) => (
        <InfoRow key={l} label={l} value={v} />
      ))}
    </>
  );
}

function Mode06List({ tests }: { tests: Mode06Test[] }) {
  const failed = tests.filter((t) => !t.passed);
  const sorted = [...failed, ...tests.filter((t) => t.passed)];
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="bodyStrong" style={{ color: failed.length ? STATUS_COLOR.defect : STATUS_COLOR.good }}>
        {failed.length ? `${failed.length} of ${tests.length} tests outside limits` : `All ${tests.length} tests within limits`}
      </Text>
      {sorted.map((t, i) => (
        <View key={`${t.mid}-${t.tid}-${i}`} style={styles.row}>
          <Icon name={t.passed ? 'check' : 'error'} size={16} color={t.passed ? STATUS_COLOR.good : STATUS_COLOR.defect} />
          <View style={styles.grow}>
            <Text variant="caption" style={{ fontWeight: '600' }}>
              {t.monitor}
            </Text>
            <Text variant="caption" tone="textMuted">
              {t.test}: {t.value} {t.unit} (limits {t.min}–{t.max})
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tableRow}>
      <Text variant="caption" tone="textMuted" style={styles.grow}>
        {label}
      </Text>
      <Text variant="caption" style={[styles.mono, styles.value]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  score: { width: 64, height: 64, borderRadius: 32, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  scoreText: { fontSize: 24, fontWeight: '800' },
  flag: { gap: 2, paddingVertical: space.xs },
  compact: { minHeight: 32, paddingVertical: 0, paddingHorizontal: space.sm },
  table: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: 4 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 },
  mono: { fontVariant: ['tabular-nums'] },
  value: { flexShrink: 1, textAlign: 'right' },
});
