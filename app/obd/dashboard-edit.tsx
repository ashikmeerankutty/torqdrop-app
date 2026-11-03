import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { Chip } from '@/components/inspection/Chip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { radius, space } from '@/constants/Theme';
import { useObd } from '@/lib/obd/connection';
import {
  activeBoard,
  type Board,
  type GaugeStyle,
  presetBoards,
  saveDashboards,
  STYLE_LABEL,
  tileId,
  useDashboards,
} from '@/lib/obd/dashboards';
import { metricDef } from '@/lib/obd/metrics';
import { MetricPicker, useAvailableMetrics } from '@/components/obd/MetricPicker';

const STYLES: GaugeStyle[] = ['dial', 'bar', 'number', 'spark'];

export default function DashboardEdit() {
  const { colors } = useTheme();
  const { tile: focusTile } = useLocalSearchParams<{ tile?: string }>();
  const obd = useObd();
  const vehicleId = obd.vehicleId;
  const dashboards = useDashboards(vehicleId);
  const board = activeBoard(dashboards);
  const [picking, setPicking] = useState<'add' | string | null>(null);
  const available = useAvailableMetrics();

  const save = (b: Board) => saveDashboards(vehicleId, { ...dashboards, boards: dashboards.boards.map((x) => (x.id === b.id ? b : x)) });
  const setTiles = (tiles: Board['tiles']) => save({ ...board, tiles });

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= board.tiles.length) return;
    const tiles = [...board.tiles];
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
    setTiles(tiles);
  }

  function addBoard() {
    const id = `b${Date.now().toString(36)}`;
    saveDashboards(vehicleId, { active: id, boards: [...dashboards.boards, { id, name: `Dashboard ${dashboards.boards.length + 1}`, tiles: [] }] });
  }

  function deleteBoard() {
    if (dashboards.boards.length <= 1) return;
    Alert.alert(`Delete "${board.name}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const boards = dashboards.boards.filter((b) => b.id !== board.id);
          saveDashboards(vehicleId, { active: boards[0].id, boards });
        },
      },
    ]);
  }

  function reset() {
    Alert.alert('Reset all dashboards?', 'Your changes to every dashboard for this car are replaced by the starting layouts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => saveDashboards(vehicleId, { active: 'drive', boards: presetBoards() }) },
    ]);
  }

  if (picking) {
    return (
      <>
        <Stack.Screen options={{ title: picking === 'add' ? 'Add a gauge' : 'Change reading' }} />
        <MetricPicker
          available={available}
          onCancel={() => setPicking(null)}
          onPick={(metric) => {
            if (picking === 'add') setTiles([...board.tiles, { id: tileId(), metric, style: 'number', wide: false }]);
            else setTiles(board.tiles.map((t) => (t.id === picking ? { ...t, metric } : t)));
            setPicking(null);
          }}
        />
      </>
    );
  }

  return (
    <Screen footer={<Button title="Add a gauge" icon="add" onPress={() => setPicking('add')} />}>
      <Stack.Screen options={{ title: 'Edit dashboards' }} />
      <View style={styles.chips}>
        {dashboards.boards.map((b) => (
          <Chip key={b.id} label={b.name} selected={b.id === board.id} onPress={() => saveDashboards(vehicleId, { ...dashboards, active: b.id })} />
        ))}
        <Chip label="+ New" selected={false} onPress={addBoard} />
      </View>
      <TextField label="Dashboard name" value={board.name} onChangeText={(name) => save({ ...board, name })} maxLength={24} />

      {board.tiles.map((t, i) => {
        const def = metricDef(t.metric);
        return (
          <Card key={t.id} highlighted={t.id === focusTile}>
            <View style={styles.row}>
              <Pressable style={styles.grow} onPress={() => setPicking(t.id)} accessibilityRole="button" accessibilityHint="Change the reading">
                <Text variant="bodyStrong">{def.name}</Text>
                <Text variant="caption" tone="tint">
                  Change reading
                </Text>
              </Pressable>
              <IconButton icon="up" label="Move up" onPress={() => move(i, -1)} disabled={i === 0} />
              <IconButton icon="down" label="Move down" onPress={() => move(i, 1)} disabled={i === board.tiles.length - 1} />
              <IconButton icon="delete" label="Remove" onPress={() => setTiles(board.tiles.filter((x) => x.id !== t.id))} />
            </View>
            <View style={styles.chips}>
              {STYLES.map((s) => (
                <Chip key={s} label={STYLE_LABEL[s]} selected={t.style === s} onPress={() => setTiles(board.tiles.map((x) => (x.id === t.id ? { ...x, style: s } : x)))} />
              ))}
              <Chip label="Full width" selected={t.wide} onPress={() => setTiles(board.tiles.map((x) => (x.id === t.id ? { ...x, wide: !x.wide } : x)))} />
            </View>
          </Card>
        );
      })}

      <Text variant="caption" tone="textMuted">
        Dials and bars refresh fastest. The adapter answers about 15–25 requests a second in total, so a dashboard with many fast gauges updates
        each one a little slower.
      </Text>
      <View style={[styles.row, { borderColor: colors.border }]}>
        {dashboards.boards.length > 1 && <Button title="Delete this dashboard" variant="danger" onPress={deleteBoard} style={styles.grow} />}
        <Button title="Reset all" variant="secondary" onPress={reset} style={styles.grow} />
      </View>
    </Screen>
  );
}

function IconButton({ icon, label, onPress, disabled }: { icon: 'up' | 'down' | 'delete'; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: pressed ? colors.surfaceRaised : 'transparent', opacity: disabled ? 0.3 : 1 }]}>
      <Icon name={icon} size={20} tone={icon === 'delete' ? 'danger' : 'textMuted'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  iconBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
