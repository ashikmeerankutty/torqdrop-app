import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { radius, space } from '@/constants/Theme';

import { Icon, type IconName } from './Icon';

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: colors.primarySoft }]}>
        <Icon name={icon} size={32} tone="primary" />
      </View>
      <Text variant="heading" style={styles.center}>
        {title}
      </Text>
      {body && (
        <Text variant="body" tone="textMuted" style={styles.center}>
          {body}
        </Text>
      )}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  badge: { width: 72, height: 72, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
