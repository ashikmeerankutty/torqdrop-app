import { router, useIsFocused } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { STATUS_COLOR } from '@/components/inspection/status';
import { GaugeTile } from '@/components/gauges/GaugeTile';
import { CarStatusCard, SIMULATED_COLOR } from '@/components/obd/CarStatusCard';
import { DriveAlertBanners } from '@/components/obd/DriveAlertBanners';
import { DtcList } from '@/components/obd/DtcList';
import { InsightFeed } from '@/components/obd/InsightFeed';
import { LiveTripCard } from '@/components/obd/LiveTripCard';
import { ToolGrid, type Tool } from '@/components/obd/ToolGrid';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { Screen } from '@/components/ui/Screen';
import { space } from '@/constants/Theme';
import { evaluateSafety } from '@/lib/diagnostics/safety-rules';
import { clearCodes, disconnect, readCodes, useObd } from '@/lib/obd/connection';
import { activeBoard, getDashboards, saveDashboards, useDashboards } from '@/lib/obd/dashboards';

const CONNECTED_TOOLS: Tool[] = [
  { icon: 'hearing', title: 'Engine sound check', body: 'AI listens, matched to live rpm', href: '/engine-check' },
  { icon: 'fullscreen', title: 'Car mode', body: 'Big gauges, landscape, HUD', href: '/obd/car-mode' },
  { icon: 'health', title: 'Health check', body: 'Readiness, freeze frame, self-tests', href: '/obd/health' },
  { icon: 'list', title: 'All sensors', body: 'Everything this car reports', href: '/obd/sensors' },
  { icon: 'chart', title: 'Graphs and logging', body: 'Plot, record, export CSV', href: '/obd/graphs' },
  { icon: 'timer', title: 'Performance', body: '0–100, quarter mile, braking', href: '/obd/performance' },
  { icon: 'battery', title: 'Battery test', body: 'Resting, cranking, charging', href: '/obd/battery' },
];

export default function DriveScreen() {
  const obd = useObd();

  if (obd.status !== 'connected') return <Disconnected />;
  return <Connected />;
}

function Disconnected() {
  const obd = useObd();
  return (
    <Screen>
      {obd.status === 'disconnected' && obd.error && (
        <Banner tone="warning" title="Connection lost">
          {obd.error}
        </Banner>
      )}
      <CarStatusCard />
      <Card onPress={() => router.push('/engine-check')}>
        <View style={styles.feature}>
          <Icon name="hearing" size={20} tone="primary" />
          <View style={styles.grow}>
            <Text variant="bodyStrong">Strange engine noise?</Text>
            <Text variant="caption" tone="textMuted">
              Film the engine for 20 seconds and AI listens for knocks, ticks, squeals and misfires. Works without an adapter too.
            </Text>
          </View>
          <Icon name="chevron" size={20} tone="textSubtle" />
        </View>
      </Card>
      <Card onPress={() => router.push('/diagnose')}>
        <View style={styles.feature}>
          <Icon name="ai" size={20} tone="primary" />
          <View style={styles.grow}>
            <Text variant="bodyStrong">Something feels wrong?</Text>
            <Text variant="caption" tone="textMuted">
              Describe what you notice, or type in a trouble code, and get a plain-language explanation.
            </Text>
          </View>
          <Icon name="chevron" size={20} tone="textSubtle" />
        </View>
      </Card>
      <Card>
        <Text variant="label" tone="textMuted">
          What you get
        </Text>
        {(
          [
            ['drive', 'Live gauges and dashboards', 'Speedometer, rev counter and 50+ sensors, laid out your way.'],
            ['health', 'Car health check', 'Trouble codes explained, readiness monitors, freeze frame and self-test results.'],
            ['route', 'Trips and fuel economy', 'Every drive logged with distance, fuel used, cost and a drive score.'],
            ['timer', 'Performance timers', '0–100 km/h, quarter mile and braking distance.'],
            ['wrench', 'Service reminders', 'Know when oil, filters and fluids are due.'],
            ['ai', 'AI insights', 'Optional notes on what the live data suggests.'],
          ] as const
        ).map(([icon, title, body]) => (
          <View key={title} style={styles.feature}>
            <Icon name={icon} size={20} tone="primary" />
            <View style={styles.grow}>
              <Text variant="bodyStrong">{title}</Text>
              <Text variant="caption" tone="textMuted">
                {body}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function Connected() {
  const obd = useObd();
  const focused = useIsFocused();
  const dashboards = useDashboards(obd.vehicleId);
  const board = activeBoard(dashboards);
  const [width, setWidth] = useState(0);

  const stored = obd.dtcs?.stored ?? [];
  const pending = obd.dtcs?.pending ?? [];
  const banners = evaluateSafety({ milOn: obd.mil?.milOn ?? false, stored, pending, coolantTemp: obd.live.coolantTemp });
  const milOn = obd.mil?.milOn ?? false;
  const half = (width - space.sm) / 2;

  function confirmClear() {
    Alert.alert(
      'Clear trouble codes?',
      'This turns off the check-engine light and resets the emissions readiness monitors. The fault itself is not fixed and the codes will come back if it is still there. Only clear codes after a repair.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear codes',
          style: 'destructive',
          onPress: () => clearCodes().catch((e) => Alert.alert('Could not clear codes', String(e?.message ?? e))),
        },
      ],
    );
  }

  return (
    <Screen>
      <View style={styles.connection}>
        {obd.simulated ? <Pill label="Simulated" color={SIMULATED_COLOR} icon="play" /> : <Pill label="Live" color={STATUS_COLOR.good} />}
        <Text variant="caption" tone="textMuted" numberOfLines={1} style={styles.grow}>
          {obd.adapterName}
          {obd.protocol ? ` · protocol ${obd.protocol}` : ''}
        </Text>
        <Button title="Disconnect" variant="ghost" onPress={disconnect} style={styles.compact} />
      </View>

      {obd.simulated && (
        <Banner tone="info" icon="play">
          Demo data from a simulated car, not from a real vehicle.
        </Banner>
      )}

      <DriveAlertBanners />
      {banners.map((b) => (
        <Banner key={b.id} solid tone={b.severity === 'urgent' ? 'danger' : 'warning'} title={b.title}>
          {b.body}
        </Banner>
      ))}

      <View style={styles.boardBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {dashboards.boards.map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              selected={b.id === board.id}
              onPress={() => saveDashboards(obd.vehicleId, { ...getDashboards(obd.vehicleId), active: b.id })}
            />
          ))}
        </ScrollView>
        <Button title="Edit" icon="edit" variant="ghost" onPress={() => router.push('/obd/dashboard-edit')} style={styles.compact} />
      </View>

      <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 &&
          board.tiles.map((tile) => (
            <GaugeTile
              key={tile.id}
              metric={tile.metric}
              style={tile.style}
              width={tile.wide ? width : half}
              active={focused}
              onLongPress={() => router.push({ pathname: '/obd/dashboard-edit', params: { tile: tile.id } })}
            />
          ))}
      </View>
      {board.tiles.length === 0 && (
        <Text tone="textMuted" style={{ textAlign: 'center' }}>
          This dashboard is empty. Tap Edit to add gauges.
        </Text>
      )}

      <LiveTripCard />

      <ToolGrid tools={CONNECTED_TOOLS} />

      <Card>
        <View style={styles.codesHeader}>
          <Text variant="heading">Trouble codes</Text>
          {obd.mil && (
            <View style={styles.mil}>
              <Icon name="engine" size={18} color={milOn ? STATUS_COLOR.attention : STATUS_COLOR.good} />
              <Text variant="caption" style={{ color: milOn ? STATUS_COLOR.attention : STATUS_COLOR.good, fontWeight: '700' }}>
                Check-engine {milOn ? 'ON' : 'off'}
              </Text>
            </View>
          )}
        </View>
        {obd.dtcs ? <DtcList stored={stored} pending={pending} /> : <Text tone="textMuted">Reading…</Text>}
        <Text variant="caption" tone="textSubtle">
          Standard OBD reads engine and emissions codes only. ABS and airbag faults need a manufacturer scan tool.
        </Text>
        <Button
          title={stored.length || pending.length ? 'Explain these codes' : 'Describe a problem'}
          icon="ai"
          onPress={() => router.push({ pathname: '/diagnose', params: { codes: [...stored, ...pending].join(',') } })}
        />
        <View style={styles.actions}>
          <Button title="Read again" variant="secondary" onPress={() => readCodes().catch(() => {})} style={styles.grow} />
          {(stored.length > 0 || pending.length > 0) && <Button title="Clear codes" variant="danger" onPress={confirmClear} style={styles.grow} />}
        </View>
      </Card>

      <InsightFeed />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  feature: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', paddingVertical: space.xs },
  connection: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  compact: { minHeight: 32, paddingVertical: 0, paddingHorizontal: space.sm },
  boardBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { gap: space.sm, paddingRight: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  codesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mil: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', gap: space.sm },
});
