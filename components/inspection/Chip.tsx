import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/components/Themed';
import { radius, space } from '@/constants/Theme';

interface Props {
  label: string;
  /** Fill colour when selected; the brand orange when not given. */
  color?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Bigger target for answering checklist items. */
  large?: boolean;
}

export function Chip({ label, color, selected, onPress, disabled, large }: Props) {
  const { colors } = useTheme();
  const fill = color ?? colors.primary;
  // Status colours are mid-tones that carry white text; the orange carries dark text.
  const selectedText = color ? '#fff' : colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        large && styles.large,
        selected
          ? { backgroundColor: fill, borderColor: fill }
          : { backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border },
      ]}>
      <Text style={[styles.label, large && styles.largeLabel, { color: selected ? selectedText : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: space.md + 2,
    minHeight: 36,
    justifyContent: 'center',
  },
  large: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md },
  label: { fontSize: 14, fontWeight: '600' },
  largeLabel: { fontSize: 15 },
});
