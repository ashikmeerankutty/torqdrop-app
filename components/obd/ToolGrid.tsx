import { type Href, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Icon, type IconName } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';

export interface Tool {
  icon: IconName;
  title: string;
  body: string;
  href: Href;
}

/** Two-column grid of feature shortcuts. */
export function ToolGrid({ tools }: { tools: Tool[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.grid}>
      {tools.map((t) => (
        <Pressable
          key={t.title}
          onPress={() => router.push(t.href)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.tool, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Icon name={t.icon} size={20} tone="primary" />
          </View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {t.title}
          </Text>
          <Text variant="caption" tone="textMuted" numberOfLines={2}>
            {t.body}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tool: { width: '48.5%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  icon: { width: 36, height: 36, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
});
