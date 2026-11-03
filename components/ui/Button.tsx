import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { radius, space, TOUCH } from '@/constants/Theme';

import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  /** Extra content under the title, e.g. a short subtitle. */
  children?: ReactNode;
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, size = 'md', style, children }: Props) {
  const { colors } = useTheme();
  const fill = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.surfaceRaised, fg: colors.text, border: colors.border },
    ghost: { bg: 'transparent', fg: colors.tint, border: 'transparent' },
    danger: { bg: 'transparent', fg: colors.danger, border: colors.border },
  }[variant];
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' && styles.lg,
        { backgroundColor: fill.bg, borderColor: fill.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fill.fg} />
      ) : (
        <View style={styles.content}>
          <View style={styles.row}>
            {icon && <Icon name={icon} size={20} color={fill.fg} />}
            <Text variant="bodyStrong" style={[{ color: fill.fg }, size === 'lg' && styles.lgText]}>
              {title}
            </Text>
          </View>
          {children}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lg: { minHeight: 56, borderRadius: radius.lg },
  lgText: { fontSize: 17, fontWeight: '700' },
  content: { alignItems: 'center', gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
