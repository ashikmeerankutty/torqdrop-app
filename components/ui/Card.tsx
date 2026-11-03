import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/components/Themed';
import { radius, space } from '@/constants/Theme';

interface Props {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Coloured left edge, used for status and severity. */
  accent?: string;
  /** Orange outline for the one card the person should act on next. */
  highlighted?: boolean;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, style, accent, highlighted, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const base = [
    styles.card,
    { backgroundColor: colors.surface, borderColor: highlighted ? colors.primary : colors.border },
    accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { backgroundColor: colors.surfaceRaised }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.sm },
});
