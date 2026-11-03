import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { STATUS_COLOR } from '@/components/inspection/status';
import { SIMULATED_COLOR } from '@/components/obd/CarStatusCard';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import { describeDtc } from '@/lib/diagnostics/dtc-database';
import { evaluateSafety, type SafetyBanner } from '@/lib/diagnostics/safety-rules';
import { SYMPTOMS, type SymptomKey } from '@/lib/diagnostics/symptoms';
import { aiErrorMessage, type DiagnoseResult, explainDtc } from '@/lib/firebase/ai';
import { getSnapshotBuilder, useObd } from '@/lib/obd/connection';
import { DTC_CODE, type DriveAdvice } from '@/lib/schemas/diagnosis';

const DRIVE: Record<DriveAdvice, { title: string; body: string; color: string; icon: IconName }> = {
  ok: {
    title: 'Okay to drive',
    body: 'Nothing here suggests you need to stop. Get it checked at your next service.',
    color: STATUS_COLOR.good,
    icon: 'check',
  },
  caution: {
    title: 'Drive gently, get it checked soon',
    body: 'Avoid hard acceleration and long trips until a mechanic has looked at it.',
    color: STATUS_COLOR.attention,
    icon: 'warning',
  },
  stop: {
    title: 'Stop driving',
    body: 'Driving on could cause damage or be unsafe. Have it checked before you drive again.',
    color: STATUS_COLOR.defect,
    icon: 'error',
  },
};

const SEVERITY_COLOR = { info: '#757575', monitor: STATUS_COLOR.acceptable, attention: STATUS_COLOR.attention, urgent: STATUS_COLOR.defect };

/**
 * Explain a problem: trouble codes from the car (or typed in), symptoms, and live data when connected.
 * The safety banners come from fixed rules and show whatever the AI says.
 */
export default function DiagnoseScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ codes?: string }>();
  const obd = useObd();
  const connected = obd.status === 'connected';
  const carCodes = connected ? [...new Set([...(obd.dtcs?.stored ?? []), ...(obd.dtcs?.pending ?? [])])] : [];
  const [codes, setCodes] = useState<string[]>(() =>
    [...new Set([...(params.codes?.split(',') ?? []), ...carCodes])].filter((c) => DTC_CODE.test(c)),
  );
  const [codeDraft, setCodeDraft] = useState('');
  const [symptoms, setSymptoms] = useState<SymptomKey[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiagnoseResult | null>(null);

  const localSafety = evaluateSafety({
    milOn: connected ? (obd.mil?.milOn ?? false) : false,
    stored: codes,
    pending: [],
    coolantTemp: connected ? obd.live.coolantTemp : null,
  });
  // Server banners use the same rules; merge so each shows once.
  const safety = mergeBanners(localSafety, result?.safety ?? []);
  const canAsk = codes.length > 0 || symptoms.length > 0 || description.trim().length > 0;

  function addCode() {
    const c = codeDraft.trim().toUpperCase();
    if (!DTC_CODE.test(c)) return setError('Codes look like P0301: a letter and four characters.');
    setError(null);
    setCodes((list) => (list.includes(c) ? list : [...list, c].slice(0, 8)));
    setCodeDraft('');
  }

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const snapshot = connected ? getSnapshotBuilder()?.build('manual') : undefined;
      const r = await explainDtc({
        codes,
        symptoms,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(snapshot && Object.keys(snapshot.pids).length ? { snapshot } : {}),
      });
      setResult(r);
      if (r.status === 'ai_unavailable') setError('AI could not answer this time. The safety notes above still apply. Try again.');
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const diagnosis = result?.status === 'ok' ? result.diagnosis : null;
  const drive = diagnosis ? DRIVE[diagnosis.driveAdvice] : null;

  return (
    <Screen
      footer={
        <Button
          title={diagnosis ? 'Ask again' : 'Explain with AI'}
          icon="ai"
          size="lg"
          disabled={!canAsk}
          loading={busy}
          onPress={ask}
        />
      }>
      {safety.map((b) => (
        <Banner key={b.id} solid tone={b.severity === 'urgent' ? 'danger' : 'warning'} title={b.title}>
          {b.body}
        </Banner>
      ))}

      {drive && diagnosis && (
        <>
          <Card accent={drive.color}>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: `${drive.color}26` }]}>
                <Icon name={drive.icon} size={26} color={drive.color} />
              </View>
              <View style={styles.grow}>
                <Text variant="heading">{drive.title}</Text>
                <Text variant="caption" tone="textMuted">
                  {drive.body}
                </Text>
              </View>
            </View>
            <Text>{diagnosis.summary}</Text>
            {result?.status === 'ok' && result.simulated && <Pill label="Based on simulated data" color={SIMULATED_COLOR} />}
          </Card>

          {diagnosis.codes.map((c) => (
            <Card key={c.code} accent={SEVERITY_COLOR[c.severity]}>
              <View style={styles.rowBetween}>
                <Text variant="heading">{c.code}</Text>
                <Pill label={DRIVE[c.driveAdvice].title.split(',')[0]} color={DRIVE[c.driveAdvice].color} />
              </View>
              <Text variant="caption" tone="textMuted">
                {describeDtc(c.code).title}
              </Text>
              <Text>{c.meaning}</Text>
              <Text variant="label" tone="textMuted" style={styles.gapTop}>
                Possible causes
              </Text>
              {c.possibleCauses.map((cause) => (
                <Bullet key={cause} text={cause} />
              ))}
              {c.checks.length > 0 && (
                <>
                  <Text variant="label" tone="textMuted" style={styles.gapTop}>
                    What a mechanic will check
                  </Text>
                  {c.checks.map((check) => (
                    <Bullet key={check} text={check} />
                  ))}
                </>
              )}
              {!!c.driveNote && (
                <Text variant="caption" tone="textMuted">
                  {c.driveNote}
                </Text>
              )}
            </Card>
          ))}

          {diagnosis.possibilities.length > 0 && (
            <Card>
              <Text variant="heading">Possible connections</Text>
              {diagnosis.possibilities.map((p) => (
                <View key={p.statement} style={[styles.possibility, { backgroundColor: colors.surfaceRaised }]}>
                  <Text variant="bodyStrong">{p.statement}</Text>
                  <Text variant="caption" tone="textMuted">
                    {p.confidence} confidence · based on {p.basedOn.map(refLabel).join(', ')}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          {diagnosis.nextSteps.length > 0 && (
            <Card>
              <Text variant="heading">What to do now</Text>
              {diagnosis.nextSteps.map((s) => (
                <Bullet key={s} text={s} />
              ))}
            </Card>
          )}

          <Text variant="caption" tone="textSubtle" style={styles.center}>
            Written by AI. It can be wrong and is not a mechanical diagnosis. A code names a failed test, not a failed part.
          </Text>
        </>
      )}

      <Card>
        <Text variant="heading">Trouble codes</Text>
        {codes.length === 0 ? (
          <Text variant="caption" tone="textMuted">
            {connected ? 'The car has no codes stored.' : 'Connect the car on the Drive tab to read codes, or type one in.'}
          </Text>
        ) : (
          <View style={styles.chips}>
            {codes.map((c) => (
              <Chip key={c} label={`${c} ×`} selected onPress={() => setCodes((list) => list.filter((x) => x !== c))} />
            ))}
          </View>
        )}
        <View style={styles.row}>
          <View style={styles.grow}>
            <TextField
              value={codeDraft}
              onChangeText={setCodeDraft}
              onSubmitEditing={addCode}
              placeholder="Add a code, e.g. P0301"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={5}
            />
          </View>
          <Button title="Add" variant="secondary" onPress={addCode} disabled={!codeDraft.trim()} />
        </View>
      </Card>

      <Card onPress={() => router.push('/engine-check')}>
        <View style={styles.row}>
          <Icon name="hearing" size={20} tone="primary" />
          <Text variant="caption" style={styles.grow}>
            Hearing a noise? Record the engine and let AI listen to it.
          </Text>
          <Icon name="chevron" size={18} tone="textSubtle" />
        </View>
      </Card>

      <Card>
        <Text variant="heading">What do you notice?</Text>
        <View style={styles.chips}>
          {(Object.keys(SYMPTOMS) as SymptomKey[]).map((k) => (
            <Chip
              key={k}
              label={SYMPTOMS[k]}
              selected={symptoms.includes(k)}
              onPress={() => setSymptoms((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]))}
            />
          ))}
        </View>
        <TextField
          label="Anything else (optional)"
          value={description}
          onChangeText={setDescription}
          placeholder="When does it happen? e.g. shakes at idle when the AC is on"
          multiline
          maxLength={500}
          hint="Don't include names or phone numbers."
        />
        {connected && (
          <View style={styles.row}>
            <Icon name="drive" size={16} tone="textMuted" />
            <Text variant="caption" tone="textMuted" style={styles.grow}>
              {obd.simulated ? 'Simulated' : 'Live'} data from the last 30 seconds will be included.
            </Text>
          </View>
        )}
      </Card>

      {error && (
        <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
          {error}
        </Text>
      )}
    </Screen>
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

function refLabel(ref: string) {
  if (ref in SYMPTOMS) return SYMPTOMS[ref as SymptomKey].toLowerCase();
  if (ref === 'description') return 'your description';
  if (ref === 'mil') return 'check-engine light';
  return ref;
}

function mergeBanners(a: SafetyBanner[], b: SafetyBanner[]) {
  const seen = new Set(a.map((x) => x.id));
  return [...a, ...b.filter((x) => !seen.has(x.id))];
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  grow: { flex: 1 },
  badge: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  gapTop: { marginTop: space.sm },
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  possibility: { borderRadius: radius.md, padding: space.md, gap: 4 },
  center: { textAlign: 'center' },
});
