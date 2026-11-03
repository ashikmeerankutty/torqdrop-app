import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/components/Themed';

/** `value` is 0–1. */
export function ProgressBar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: colors.surfaceRaised }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color ?? colors.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
  fill: { height: '100%' },
});
