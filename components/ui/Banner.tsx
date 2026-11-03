import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { radius, space } from '@/constants/Theme';

import { Icon, type IconName } from './Icon';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { color: string; icon: IconName }> = {
  info: { color: '#3B82F6', icon: 'info' },
  success: { color: STATUS_COLOR.good, icon: 'check' },
  warning: { color: STATUS_COLOR.attention, icon: 'warning' },
  danger: { color: STATUS_COLOR.defect, icon: 'error' },
};

/** A tinted message box. `solid` is for safety warnings that must not be missed. */
export function Banner({
  tone,
  title,
  children,
  solid,
  icon,
}: {
  tone: Tone;
  title?: string;
  children?: ReactNode;
  solid?: boolean;
  icon?: IconName;
}) {
  const { colors } = useTheme();
  const t = TONES[tone];
  const fg = solid ? '#fff' : colors.text;
  return (
    <View
      style={[
        styles.banner,
        solid ? { backgroundColor: t.color } : { backgroundColor: `${t.color}22`, borderColor: `${t.color}66`, borderWidth: 1 },
      ]}>
      <Icon name={icon ?? t.icon} size={20} color={solid ? '#fff' : t.color} />
      <View style={styles.body}>
        {title && (
          <Text variant="bodyStrong" style={{ color: fg }}>
            {title}
          </Text>
        )}
        {typeof children === 'string' ? (
          <Text variant="caption" style={{ color: fg, opacity: solid ? 0.95 : 0.85 }}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
});
