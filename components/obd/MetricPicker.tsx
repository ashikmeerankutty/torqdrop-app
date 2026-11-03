import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import { useObd } from '@/lib/obd/connection';
import { DERIVED_KEYS, metricDef, type MetricKey } from '@/lib/obd/metrics';
import { CATEGORY_LABEL, PID_KEYS, type PidCategory } from '@/lib/obd/pid-decoder';

/** Metrics to offer: what the connected car supports, or everything when offline. */
export function useAvailableMetrics(): MetricKey[] {
  const obd = useObd();
  const pids = obd.status === 'connected' ? obd.supportedKeys : PID_KEYS;
  return [...pids, 'batteryVoltage', ...DERIVED_KEYS];
}

const GROUP_ORDER: (PidCategory | 'derived')[] = ['engine', 'derived', 'fuel', 'temperature', 'air', 'electrical', 'emissions', 'diesel', 'distance'];

/** Full-screen list of readings, grouped and searchable. */
export function MetricPicker({ available, onPick, onCancel }: { available: MetricKey[]; onPick: (k: MetricKey) => void; onCancel: () => void }) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const items = available.filter((k) => !q || metricDef(k).name.toLowerCase().includes(q));
  return (
    <Screen footer={<Button title="Cancel" variant="secondary" onPress={onCancel} />}>
      <TextField placeholder="Search readings" value={query} onChangeText={setQuery} autoCorrect={false} />
      {GROUP_ORDER.map((cat) => {
        const group = items.filter((k) => metricDef(k).category === cat);
        if (!group.length) return null;
        return (
          <View key={cat} style={styles.group}>
            <Text variant="label" tone="textMuted">
              {cat === 'derived' ? 'Worked out from other readings' : CATEGORY_LABEL[cat]}
            </Text>
            {group.map((k) => {
              const def = metricDef(k);
              return (
                <Pressable
                  key={k}
                  onPress={() => onPick(k)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.pick, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border }]}>
                  <Text style={styles.grow}>{def.name}</Text>
                  <Text variant="caption" tone="textMuted">
                    {def.unit}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  group: { gap: space.xs },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, padding: space.md, minHeight: 48 },
});
