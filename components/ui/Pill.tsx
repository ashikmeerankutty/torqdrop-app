import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { radius } from '@/constants/Theme';

import { Icon, type IconName } from './Icon';

/** A small filled label for statuses. `color` is a mid-tone that carries white text. */
export function Pill({ label, color, icon }: { label: string; color: string; icon?: IconName }) {
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      {icon && <Icon name={icon} size={12} color="#fff" />}
      <Text variant="caption" style={styles.text}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  text: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
