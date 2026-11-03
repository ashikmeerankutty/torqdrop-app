import { type ComponentProps, type ReactNode, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { radius, space, TOUCH } from '@/constants/Theme';

type Props = ComponentProps<typeof TextInput> & {
  label?: string;
  hint?: string;
  error?: string | null;
  /** Fixed text before the input, e.g. "+91". */
  prefix?: string;
  /** Element after the input, e.g. a unit. */
  suffix?: ReactNode;
  large?: boolean;
};

export function TextField({ label, hint, error, prefix, suffix, large, style, onFocus, onBlur, ...input }: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={styles.field}>
      {label && (
        <Text variant="caption" tone="textMuted" style={styles.label}>
          {label}
        </Text>
      )}
      <View style={[styles.box, { borderColor, backgroundColor: colors.surface }, large && styles.largeBox]}>
        {prefix && (
          <Text variant={large ? 'heading' : 'body'} tone="textMuted">
            {prefix}
          </Text>
        )}
        <TextInput
          placeholderTextColor={colors.textSubtle}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          style={[styles.input, { color: colors.text }, large && styles.largeInput, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...input}
        />
        {typeof suffix === 'string' ? (
          <Text variant="body" tone="textMuted">
            {suffix}
          </Text>
        ) : (
          suffix
        )}
      </View>
      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="textSubtle">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontWeight: '600' },
  box: {
    minHeight: TOUCH,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  largeBox: { minHeight: 60, paddingHorizontal: space.lg },
  input: { flex: 1, fontSize: 16, paddingVertical: space.sm },
  largeInput: { fontSize: 22, fontWeight: '600' },
});
