import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/components/Themed';
import { STATUS_COLOR } from '@/components/inspection/status';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { radius, space } from '@/constants/Theme';
import { LIKELY_ADAPTER } from '@/lib/obd/ble-transport';
import { connectAdapter, connectSimulated, disconnect, startScan, stopScanning, useObd } from '@/lib/obd/connection';

const STEPS = [
  'Plug the adapter into the OBD port, usually under the steering wheel.',
  'Turn the ignition on, or start the engine.',
  'Scan and pick the adapter below.',
];

/** 1–4 bars from RSSI, so signal strength reads without knowing what dBm means. */
function bars(rssi: number | null | undefined) {
  if (rssi == null) return 0;
  return rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -80 ? 2 : 1;
}

export default function ConnectScreen() {
  const { colors } = useTheme();
  const obd = useObd();

  // Close once a connection made here succeeds. Opening this screen while already connected (for
  // example to swap the simulated car for a real adapter) must not close it straight away.
  const prevStatus = useRef(obd.status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = obd.status;
    if (obd.status === 'connected' && was !== 'connected' && router.canGoBack()) router.back();
  }, [obd.status]);
  useEffect(() => stopScanning, []);

  const devices = [...obd.devices].sort(
    (a, b) => Number(LIKELY_ADAPTER.test(b.name)) - Number(LIKELY_ADAPTER.test(a.name)) || (b.rssi ?? -999) - (a.rssi ?? -999),
  );
  const busy = obd.status === 'connecting';
  const scanning = obd.status === 'scanning';
  const connected = obd.status === 'connected';
  const [switching, setSwitching] = useState(false);

  /** Ends the current session (simulated or real), then looks for adapters. */
  async function switchAdapter() {
    setSwitching(true);
    try {
      await disconnect();
      await startScan();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={devices}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.container}
        ListHeaderComponent={
          <View style={styles.header}>
            {connected && (
              <Card highlighted>
                <View style={styles.row}>
                  <View style={[styles.deviceIcon, { backgroundColor: colors.primarySoft }]}>
                    <Icon name={obd.simulated ? 'play' : 'bluetooth'} size={20} tone="primary" />
                  </View>
                  <View style={styles.grow}>
                    <Text variant="bodyStrong">
                      {obd.simulated ? 'The simulated car is running' : `Connected to ${obd.adapterName ?? 'the adapter'}`}
                    </Text>
                    <Text variant="caption" tone="textMuted">
                      {obd.simulated
                        ? 'Stop it to connect your real adapter. Nothing from the simulated car is saved.'
                        : 'Disconnect first to switch to a different adapter.'}
                    </Text>
                  </View>
                </View>
                <Button
                  title={obd.simulated ? 'Stop simulator and scan' : 'Disconnect and scan'}
                  icon="scanning"
                  loading={switching}
                  onPress={switchAdapter}
                />
                <Button
                  title={obd.simulated ? 'Keep using the simulator' : 'Stay connected'}
                  variant="ghost"
                  onPress={() => router.back()}
                />
              </Card>
            )}
            <Card>
              {STEPS.map((s, i) => (
                <View key={s} style={styles.step}>
                  <View style={[styles.stepNum, { backgroundColor: colors.primarySoft }]}>
                    <Text variant="caption" tone="primary" style={styles.stepNumText}>
                      {i + 1}
                    </Text>
                  </View>
                  <Text variant="body" style={styles.grow}>
                    {s}
                  </Text>
                </View>
              ))}
            </Card>
            {!connected && (
              <Button
                title={scanning ? 'Scanning…' : devices.length ? 'Scan again' : 'Scan for adapters'}
                icon="scanning"
                size="lg"
                loading={busy}
                disabled={scanning}
                onPress={startScan}
              />
            )}
            {obd.step && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.primary} />
                <Text tone="textMuted">{obd.step}</Text>
              </View>
            )}
            {obd.error && (
              <Banner tone="danger" title="Couldn't connect">
                {obd.error}
              </Banner>
            )}
            {devices.length > 0 && (
              <Text variant="label" tone="textMuted">
                Nearby devices
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          scanning ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.primary} />
              <Text tone="textMuted">Looking for Bluetooth devices…</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const likely = LIKELY_ADAPTER.test(item.name);
          const signal = bars(item.rssi);
          return (
            <Card onPress={busy || connected ? undefined : () => connectAdapter(item)} highlighted={likely} style={styles.device}>
              <View style={styles.row}>
                <View style={[styles.deviceIcon, { backgroundColor: likely ? colors.primarySoft : colors.surfaceRaised }]}>
                  <Icon name="bluetooth" size={20} color={likely ? colors.primary : colors.textMuted} />
                </View>
                <View style={styles.grow}>
                  <Text variant="bodyStrong">{item.name}</Text>
                  {likely ? (
                    <Pill label="Likely OBD adapter" color={STATUS_COLOR.good} />
                  ) : (
                    <Text variant="caption" tone="textMuted">
                      Bluetooth device
                    </Text>
                  )}
                </View>
                <View style={styles.bars} accessibilityLabel={`Signal ${signal} of 4`}>
                  {[1, 2, 3, 4].map((b) => (
                    <View
                      key={b}
                      style={[styles.bar, { height: 4 + b * 4, backgroundColor: b <= signal ? colors.text : colors.border }]}
                    />
                  ))}
                </View>
              </View>
            </Card>
          );
        }}
        ListFooterComponent={
          connected ? undefined : (
            <View style={styles.footer}>
              <Text variant="caption" tone="textSubtle">
                No adapter?
              </Text>
              <Button title="Use a simulated car" icon="play" variant="ghost" onPress={connectSimulated} disabled={busy} />
              <Text variant="caption" tone="textSubtle" style={styles.center}>
                Demo data, clearly labelled “Simulated”.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: space.lg, gap: space.sm },
  header: { gap: space.lg, marginBottom: space.xs },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'center', paddingVertical: 2 },
  stepNum: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { fontWeight: '800' },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  grow: { flex: 1, gap: 4 },
  device: { paddingVertical: space.md },
  deviceIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 20 },
  bar: { width: 4, borderRadius: 1 },
  footer: { alignItems: 'center', paddingVertical: space.xl, gap: 2 },
  center: { textAlign: 'center' },
});
