import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { radius, space } from '@/constants/Theme';

import { Icon } from './Icon';

/** Wordmark: orange gauge badge + "TorqDrop". */
export function Brand({ large }: { large?: boolean }) {
  const { colors } = useTheme();
  const size = large ? 56 : 40;
  return (
    <View style={styles.row}>
      <View style={[styles.badge, { width: size, height: size, backgroundColor: colors.primary }]}>
        <Icon name="drive" size={size * 0.6} color={colors.onPrimary} />
      </View>
      <Text variant={large ? 'display' : 'title'}>
        Torq<Text variant={large ? 'display' : 'title'} tone="primary">Drop</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
