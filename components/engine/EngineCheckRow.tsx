import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Icon } from '@/components/ui/Icon';
import { space } from '@/constants/Theme';
import type { EngineCheck } from '@/lib/engine-check';
import { ENGINE_SOUNDS } from '@/lib/schemas/engine-sound';

import { SOUND_VERDICT } from './verdict';

/** One past engine sound check in a list. */
export function EngineCheckRow({ check }: { check: EngineCheck }) {
  const { colors } = useTheme();
  const v = SOUND_VERDICT[check.result.driveAdvice];
  const poor = check.result.clipQuality === 'poor';
  const heard = check.result.sounds.map((s) => ENGINE_SOUNDS[s.kind].toLowerCase());
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/engine-check/[id]', params: { id: check.id } })}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1, borderTopColor: colors.border }]}>
      <View style={[styles.dot, { backgroundColor: poor ? colors.textSubtle : v.color }]} />
      <View style={styles.grow}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {poor ? 'Unclear recording' : v.title}
        </Text>
        <Text variant="caption" tone="textMuted" numberOfLines={1}>
          {new Date(check.at).toLocaleDateString()}
          {check.simulated ? ' · simulated data' : ''}
          {heard.length ? ` · ${heard.join(', ')}` : ''}
        </Text>
      </View>
      <Icon name="chevron" size={18} tone="textSubtle" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  dot: { width: 10, height: 10, borderRadius: 5 },
  grow: { flex: 1 },
});
