import { StyleSheet, View as RNView } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Icon } from '@/components/ui/Icon';
import { radius, space } from '@/constants/Theme';
import { describeDtc } from '@/lib/diagnostics/dtc-database';

/** Stored and pending codes with plain-language titles. A code names a failed check, not a failed part. */
export function DtcList({ stored, pending }: { stored: string[]; pending: string[] }) {
  const { colors } = useTheme();
  if (!stored.length && !pending.length) {
    return (
      <RNView style={styles.none}>
        <Icon name="check" size={20} color={STATUS_COLOR.good} />
        <Text variant="bodyStrong">No trouble codes stored</Text>
      </RNView>
    );
  }
  const rows = [
    ...stored.map((code) => ({ code, pending: false })),
    ...pending.filter((c) => !stored.includes(c)).map((code) => ({ code, pending: true })),
  ];
  return (
    <RNView style={styles.list}>
      {rows.map(({ code, pending: isPending }) => {
        const info = describeDtc(code);
        return (
          <RNView key={code} style={[styles.row, { backgroundColor: colors.surfaceRaised }]}>
            <Text
              style={[styles.code, { backgroundColor: isPending ? STATUS_COLOR.attention : STATUS_COLOR.defect }]}>
              {info.code}
            </Text>
            <RNView style={styles.grow}>
              <Text variant="bodyStrong">{info.title}</Text>
              <Text variant="caption" tone="textMuted">
                {isPending ? 'Pending: seen once, not confirmed yet' : 'Stored'}
                {info.manufacturerSpecific ? ' · needs a manufacturer scan tool for details' : ''}
              </Text>
            </RNView>
          </RNView>
        );
      })}
    </RNView>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, borderRadius: radius.md },
  code: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  grow: { flex: 1, gap: 2 },
  none: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
