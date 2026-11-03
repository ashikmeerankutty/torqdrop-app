import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View as RNView } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';
import { aiErrorMessage, analyzeLiveSnapshot } from '@/lib/firebase/ai';
import { getSnapshotBuilder, useObd } from '@/lib/obd/connection';
import { evidenceLabel } from '@/lib/obd/pid-decoder';
import type { InsightCard } from '@/lib/schemas/insight';

const INTERVAL_MS = 20_000;

const BASIS: Record<InsightCard['basis'], string> = {
  measured: 'Measured',
  ai_observation: 'AI observation',
  hypothesis: 'Hypothesis, unverified',
};

const SEVERITY_COLOR: Record<InsightCard['severity'], string> = {
  info: STATUS_COLOR.not_applicable,
  monitor: STATUS_COLOR.acceptable,
  attention: STATUS_COLOR.attention,
  urgent: STATUS_COLOR.defect,
};

/**
 * AI insight cards from rolling snapshots of the live data. Off by default to keep cost down;
 * runs only while the Drive tab is focused, one request at a time.
 */
export function InsightFeed() {
  const obd = useObd();
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [focused, setFocused] = useState(true);
  const [cards, setCards] = useState<InsightCard[] | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const run = useCallback(async (trigger: string) => {
    const builder = getSnapshotBuilder();
    if (!builder || inFlight.current) return;
    const snapshot = builder.build(trigger);
    if (!Object.keys(snapshot.pids).length) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await analyzeLiveSnapshot(snapshot);
      if (result.status === 'ok') {
        setCards(result.cards);
        setSimulated(snapshot.simulated);
        setError(null);
      } else {
        setError('AI is unavailable right now. Live data and safety warnings still work.');
      }
    } catch (e) {
      setError(aiErrorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  const active = enabled && focused && obd.status === 'connected';

  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => run('interval'), 2_000);
    const timer = setInterval(() => run('interval'), INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, run]);

  // A change in the codes is worth an immediate look.
  const codesKey = [...(obd.dtcs?.stored ?? []), '|', ...(obd.dtcs?.pending ?? [])].join(',');
  const lastCodes = useRef(codesKey);
  useEffect(() => {
    if (codesKey === lastCodes.current) return;
    lastCodes.current = codesKey;
    if (!active) return;
    const t = setTimeout(() => run('new_dtc'), 0);
    return () => clearTimeout(t);
  }, [codesKey, active, run]);

  return (
    <Card>
      <RNView style={styles.header}>
        <Icon name="ai" size={20} tone="primary" />
        <Text variant="heading" style={styles.grow}>
          AI insights
        </Text>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          trackColor={{ true: colors.primary, false: colors.surfaceRaised }}
          thumbColor="#fff"
        />
      </RNView>
      {!enabled ? (
        <Text variant="caption" tone="textMuted">
          Turn on to get plain-language notes on the live data every 20 seconds. Safety warnings above never depend on AI.
        </Text>
      ) : (
        <>
          {busy && !cards && (
            <RNView style={styles.row}>
              <ActivityIndicator color={colors.primary} />
              <Text variant="caption" tone="textMuted">
                Collecting data and asking the AI…
              </Text>
            </RNView>
          )}
          {error && (
            <Text variant="caption" style={{ color: STATUS_COLOR.attention }}>
              {error}
            </Text>
          )}
          {cards?.length === 0 && (
            <Text variant="caption" tone="textMuted">
              Nothing notable in the last 30 seconds.
            </Text>
          )}
          {cards?.map((c, i) => (
            <RNView
              key={`${c.title}-${i}`}
              style={[styles.card, { backgroundColor: colors.surfaceRaised, borderLeftColor: SEVERITY_COLOR[c.severity] }]}>
              <Text variant="caption" tone="textMuted">
                {simulated ? 'SIMULATED · ' : ''}
                {BASIS[c.basis]} · {c.confidence} confidence
              </Text>
              <Text variant="bodyStrong">{c.title}</Text>
              <Text variant="caption">{c.body}</Text>
              {!!c.uncertainty && (
                <Text variant="caption" tone="textMuted">
                  Uncertainty: {c.uncertainty}
                </Text>
              )}
              <Text variant="caption" tone="textSubtle">
                Based on: {c.evidenceRefs.map(evidenceLabel).join(', ')}
              </Text>
            </RNView>
          ))}
          {cards && (
            <Text variant="caption" tone="textSubtle">
              AI notes can be wrong. They are not a mechanical diagnosis.
            </Text>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  card: { borderLeftWidth: 4, borderRadius: radius.md, padding: space.md, gap: 4 },
});
