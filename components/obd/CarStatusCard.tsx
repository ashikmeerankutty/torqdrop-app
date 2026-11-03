import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { radius, space } from '@/constants/Theme';
import { evaluateSafety } from '@/lib/diagnostics/safety-rules';
import { connectSimulated, useObd } from '@/lib/obd/connection';

export const SIMULATED_COLOR = '#8E44AD';

/** Car health at a glance: the connect prompt when no adapter, a one-line verdict when connected. */
export function CarStatusCard({ compact }: { compact?: boolean }) {
  const { colors } = useTheme();
  const obd = useObd();

  if (obd.status !== 'connected') {
    if (compact) {
      return (
        <Card onPress={() => router.push('/connect')}>
          <View style={styles.row}>
            <View style={[styles.iconBadge, { backgroundColor: colors.surfaceRaised }]}>
              <Icon name="bluetooth" size={20} tone="textMuted" />
            </View>
            <View style={styles.grow}>
              <Text variant="bodyStrong">No adapter connected</Text>
              <Text variant="caption" tone="textMuted">
                Connect one to run the ECU scan during inspections
              </Text>
            </View>
            <Icon name="chevron" size={20} tone="textSubtle" />
          </View>
        </Card>
      );
    }
    return (
      <Card>
        <View style={styles.row}>
          <View style={[styles.iconBadge, styles.iconLarge, { backgroundColor: colors.primarySoft }]}>
            <Icon name="drive" size={28} tone="primary" />
          </View>
          <View style={styles.grow}>
            <Text variant="heading">Connect your car</Text>
            <Text variant="caption" tone="textMuted">
              Plug a Bluetooth OBD adapter into the port under the steering wheel to see live engine data and trouble
              codes.
            </Text>
          </View>
        </View>
        <Button title="Connect adapter" icon="bluetooth" onPress={() => router.push('/connect')} />
        <Button title="Try with a simulated car" variant="ghost" icon="play" onPress={connectSimulated} />
      </Card>
    );
  }

  const stored = obd.dtcs?.stored ?? [];
  const pending = obd.dtcs?.pending ?? [];
  const banners = evaluateSafety({ milOn: obd.mil?.milOn ?? false, stored, pending, coolantTemp: obd.live.coolantTemp });
  const urgent = banners.some((b) => b.severity === 'urgent');
  const verdict = urgent
    ? { color: STATUS_COLOR.defect, icon: 'error' as const, title: 'Needs attention now', body: banners[0].title }
    : banners.length
      ? { color: STATUS_COLOR.attention, icon: 'warning' as const, title: 'Check soon', body: banners[0].title }
      : !obd.dtcs
        ? { color: '#1E6FD9', icon: 'scanning' as const, title: 'Checking the car…', body: 'Reading trouble codes' }
        : { color: STATUS_COLOR.good, icon: 'check' as const, title: 'All looks normal', body: 'No trouble codes stored' };

  return (
    <Card onPress={() => router.push('/drive')} accent={verdict.color}>
      <View style={styles.row}>
        <View style={[styles.iconBadge, styles.iconLarge, { backgroundColor: `${verdict.color}26` }]}>
          <Icon name={verdict.icon} size={28} color={verdict.color} />
        </View>
        <View style={styles.grow}>
          <Text variant="heading">{verdict.title}</Text>
          <Text variant="caption" tone="textMuted" numberOfLines={2}>
            {verdict.body}
          </Text>
        </View>
        <Icon name="chevron" size={20} tone="textSubtle" />
      </View>
      <View style={styles.row}>
        {obd.simulated ? <Pill label="Simulated" color={SIMULATED_COLOR} /> : <Pill label="Live" color={STATUS_COLOR.good} />}
        <Text variant="caption" tone="textMuted" numberOfLines={1} style={styles.grow}>
          {obd.adapterName}
        </Text>
        {obd.live.coolantTemp != null && (
          <Text variant="caption" tone="textMuted">
            {Math.round(obd.live.coolantTemp)} °C
          </Text>
        )}
        {obd.live.moduleVoltage != null && (
          <Text variant="caption" tone="textMuted">
            {obd.live.moduleVoltage.toFixed(1)} V
          </Text>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, gap: 2 },
  iconBadge: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  iconLarge: { width: 52, height: 52 },
});
