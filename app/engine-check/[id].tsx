import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Svg, { Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { clipTime, SEVERITY_COLOR, SEVERITY_LABEL, SOUND_VERDICT } from '@/components/engine/verdict';
import { SIMULATED_COLOR } from '@/components/obd/CarStatusCard';
import { Text, useTheme } from '@/components/Themed';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { radius, space } from '@/constants/Theme';
import { useDbQuery } from '@/lib/db/use-query';
import { deleteEngineCheck, type EngineCheck, getEngineCheck } from '@/lib/engine-check';
import { CLIP_PLACES, ENGINE_CONCERNS, ENGINE_SOUNDS, type HeardSound } from '@/lib/schemas/engine-sound';

const RHYTHM = {
  even: { label: 'Even', body: 'The idle beat sounded steady.', step: 0 },
  slightly_uneven: { label: 'Slightly uneven', body: 'Small irregularities in the idle beat.', step: 1 },
  uneven: { label: 'Uneven', body: 'The idle beat skips or stumbles, which can mean a misfire.', step: 2 },
} as const;

/** The result of one engine sound check. */
export default function EngineCheckResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { data: check, loading } = useDbQuery(() => getEngineCheck(id), [id], ['engine_checks']);

  if (loading) return <Screen>{null}</Screen>;
  if (!check) {
    return (
      <Screen>
        <Text tone="textMuted">This check was deleted.</Text>
      </Screen>
    );
  }
  const r = check.result;
  const poor = r.clipQuality === 'poor';
  const v = SOUND_VERDICT[r.driveAdvice];

  function remove() {
    Alert.alert('Delete this check?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteEngineCheck(check!.id);
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen footer={<Button title="Record another clip" icon="videocam" variant={poor ? 'primary' : 'secondary'} onPress={() => router.replace('/engine-check')} />}>
      {check.safety.map((b) => (
        <Banner key={b.id} solid tone={b.severity === 'urgent' ? 'danger' : 'warning'} title={b.title}>
          {b.body}
        </Banner>
      ))}

      {poor ? (
        <Card accent={colors.textSubtle}>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: colors.surfaceRaised }]}>
              <Icon name="mic" size={26} tone="textMuted" />
            </View>
            <View style={styles.grow}>
              <Text variant="heading">The engine wasn&apos;t clear enough</Text>
              <Text variant="caption" tone="textMuted">
                {r.qualityNote || 'Record again closer to the engine, somewhere quieter.'}
              </Text>
            </View>
          </View>
          <Text>{r.summary}</Text>
        </Card>
      ) : (
        <Card accent={v.color}>
          <View style={styles.row}>
            <View style={[styles.badge, { backgroundColor: `${v.color}26` }]}>
              <Icon name={v.icon} size={26} color={v.color} />
            </View>
            <View style={styles.grow}>
              <Text variant="heading">{v.title}</Text>
              <Text variant="caption" tone="textMuted">
                {v.body}
              </Text>
            </View>
          </View>
          <Text>{r.summary}</Text>
          <View style={styles.pills}>
            {check.simulated && <Pill label="Engine data was simulated" color={SIMULATED_COLOR} />}
            {r.clipQuality === 'usable' && <Pill label="Recording was only fair" color="#757575" />}
          </View>
        </Card>
      )}

      {!poor && (check.trace.some((p) => p.rpm != null) || r.sounds.some((s) => s.fromS != null)) && <Timeline check={check} />}

      {!poor && r.idleRhythm && (
        <Card>
          <Text variant="heading">Idle rhythm</Text>
          <View style={styles.rhythm}>
            {(['even', 'slightly_uneven', 'uneven'] as const).map((k, i) => {
              const active = RHYTHM[r.idleRhythm!].step === i;
              const color = [SEVERITY_COLOR.monitor, SEVERITY_COLOR.attention, SEVERITY_COLOR.urgent][i];
              return (
                <View
                  key={k}
                  style={[styles.rhythmStep, { backgroundColor: active ? color : colors.surfaceRaised, borderColor: active ? color : colors.border }]}>
                  <Text variant="caption" style={{ color: active ? '#fff' : colors.textMuted, fontWeight: active ? '700' : '400' }}>
                    {RHYTHM[k].label}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text variant="caption" tone="textMuted">
            {RHYTHM[r.idleRhythm].body}
          </Text>
        </Card>
      )}

      {!poor && (
        <Text variant="label" tone="textMuted">
          {r.sounds.length ? 'What the AI heard' : 'No unusual sounds heard'}
        </Text>
      )}
      {!poor && r.sounds.map((s, i) => <SoundCard key={`${s.kind}-${i}`} sound={s} n={i + 1} />)}

      {!poor && r.seen.length > 0 && (
        <Card>
          <Text variant="heading">What the AI saw</Text>
          {r.seen.map((o) => (
            <Bullet key={o.observation} text={`${o.observation}${o.fromS != null ? ` (at ${clipTime(o.fromS)})` : ''} · ${o.confidence} confidence`} />
          ))}
        </Card>
      )}

      {!poor && r.obdNotes.length > 0 && (
        <Card>
          <View style={styles.row}>
            <Icon name="bluetooth" size={18} tone="primary" />
            <Text variant="heading">What the engine data says</Text>
          </View>
          {r.obdNotes.map((n) => (
            <Bullet key={n} text={n} />
          ))}
        </Card>
      )}

      {r.nextSteps.length > 0 && (
        <Card>
          <Text variant="heading">What to do now</Text>
          {r.nextSteps.map((s) => (
            <Bullet key={s} text={s} />
          ))}
        </Card>
      )}

      <Card>
        <Text variant="caption" tone="textMuted">
          {new Date(check.at).toLocaleString()} · {Math.round(check.durationS)} s · {CLIP_PLACES[check.place].toLowerCase()}
        </Text>
        {check.concerns.length > 0 && (
          <Text variant="caption" tone="textMuted">
            You noticed: {check.concerns.map((c) => ENGINE_CONCERNS[c].toLowerCase()).join(', ')}
          </Text>
        )}
        <Button title="Explain trouble codes and symptoms" icon="ai" variant="ghost" onPress={() => router.push('/diagnose')} />
        <Button title="Delete this check" icon="delete" variant="ghost" onPress={remove} />
      </Card>

      <Text variant="caption" tone="textSubtle" style={styles.center}>
        Written by AI from a phone recording. It can be wrong and is not a mechanical diagnosis. A mechanic listening in person is the real test.
      </Text>
    </Screen>
  );
}

function SoundCard({ sound: s, n }: { sound: HeardSound; n: number }) {
  const color = SEVERITY_COLOR[s.severity];
  const when = s.fromS != null ? (s.toS != null && s.toS > s.fromS + 0.5 ? `${clipTime(s.fromS)}–${clipTime(s.toS)}` : clipTime(s.fromS)) : 'throughout';
  return (
    <Card accent={color}>
      <View style={styles.rowBetween}>
        <View style={[styles.row, styles.grow]}>
          <View style={[styles.num, { backgroundColor: color }]}>
            <Text variant="caption" style={styles.numText}>
              {n}
            </Text>
          </View>
          <Text variant="heading" style={styles.grow}>
            {ENGINE_SOUNDS[s.kind]}
          </Text>
        </View>
        <Pill label={SEVERITY_LABEL[s.severity]} color={color} />
      </View>
      <Text variant="caption" tone="textMuted">
        Heard {when} · {s.confidence} confidence
      </Text>
      <Text>{s.description}</Text>
      <Text variant="label" tone="textMuted" style={styles.gapTop}>
        Could be
      </Text>
      {s.likelySources.map((src) => (
        <Bullet key={src} text={src} />
      ))}
    </Card>
  );
}

/** Engine speed over the clip with each heard sound marked where it was clearest. One axis: rpm. */
function Timeline({ check }: { check: EngineCheck }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const h = 120;
  const pad = { l: 40, r: 8, t: 8, b: 20 };
  const d = Math.max(check.durationS, 1);
  const rpmPts = check.trace.filter((p) => p.rpm != null) as { t: number; rpm: number }[];
  const maxRpm = Math.max(1000, ...rpmPts.map((p) => p.rpm));
  const top = Math.ceil(maxRpm / 1000) * 1000;
  const x = (t: number) => pad.l + (Math.min(t, d) / d) * (width - pad.l - pad.r);
  const y = (rpm: number) => pad.t + (1 - rpm / top) * (h - pad.t - pad.b);
  const marked = check.result.sounds.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.fromS != null);

  return (
    <Card>
      <Text variant="heading">Clip timeline</Text>
      <Text variant="caption" tone="textMuted">
        {rpmPts.length ? 'Engine speed from the adapter, with where each sound was heard.' : 'Where each sound was heard in the clip.'}
      </Text>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={h} accessibilityLabel="Clip timeline">
            {marked.map(({ s, n }) => {
              const x0 = x(s.fromS!);
              const x1 = Math.max(x0 + 6, x(s.toS ?? s.fromS! + 1));
              return (
                <Rect key={n} x={x0} y={pad.t} width={x1 - x0} height={h - pad.t - pad.b} rx={4} fill={SEVERITY_COLOR[s.severity]} opacity={0.22} />
              );
            })}
            {marked.map(({ s, n }) => (
              <SvgText key={`l${n}`} x={x(s.fromS!) + 4} y={pad.t + 12} fontSize={11} fontWeight="700" fill={colors.text}>
                {n}
              </SvgText>
            ))}
            {rpmPts.length > 0 && (
              <>
                <Line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke={colors.border} strokeWidth={1} />
                <Line x1={pad.l} x2={width - pad.r} y1={y(top)} y2={y(top)} stroke={colors.border} strokeWidth={1} strokeDasharray="3 4" />
                <SvgText x={pad.l - 6} y={y(top) + 4} fontSize={10} textAnchor="end" fill={colors.textMuted}>
                  {(top / 1000).toFixed(0)}k
                </SvgText>
                <SvgText x={pad.l - 6} y={y(0) + 4} fontSize={10} textAnchor="end" fill={colors.textMuted}>
                  0
                </SvgText>
                <Polyline
                  points={rpmPts.map((p) => `${x(p.t)},${y(p.rpm)}`).join(' ')}
                  fill="none"
                  stroke={colors.chart}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            )}
            {[0, d / 2, d].map((t) => (
              <SvgText key={t} x={x(t)} y={h - 4} fontSize={10} textAnchor={t === 0 ? 'start' : t === d ? 'end' : 'middle'} fill={colors.textMuted}>
                {clipTime(t)}
              </SvgText>
            ))}
          </Svg>
        )}
      </View>
      {rpmPts.length > 0 && (
        <Text variant="caption" tone="textSubtle">
          rpm, {Math.round(Math.min(...rpmPts.map((p) => p.rpm))).toLocaleString()}–{Math.round(maxRpm).toLocaleString()} during the clip
        </Text>
      )}
    </Card>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text tone="textMuted">•</Text>
      <Text variant="caption" style={styles.grow}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  grow: { flex: 1 },
  badge: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rhythm: { flexDirection: 'row', gap: space.xs },
  rhythmStep: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.sm, borderWidth: 1 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#fff', fontWeight: '700' },
  gapTop: { marginTop: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  center: { textAlign: 'center' },
});
