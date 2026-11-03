import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/Themed';
import { space } from '@/constants/Theme';

interface Props {
  children: ReactNode;
  /** Pinned action area at the bottom, above the home indicator. */
  footer?: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Screens without a header (sign-in, onboarding) need the top inset too. */
  edgeToEdge?: boolean;
}

export function Screen({ children, footer, scroll = true, contentStyle, edgeToEdge }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const top = edgeToEdge ? insets.top + space.lg : space.lg;
  const content = [styles.content, { paddingTop: top }, contentStyle];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[content, !footer && { paddingBottom: space.xxl + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, content]}>{children}</View>
      )}
      {footer && (
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + space.md, backgroundColor: colors.background, borderTopColor: colors.border },
          ]}>
          {footer}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, gap: space.sm },
});
