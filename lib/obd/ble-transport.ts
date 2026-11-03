import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Characteristic, type Device, type Subscription } from "react-native-ble-plx";

import type { Transport } from "./transport";

let manager: BleManager | null = null;
export const bleManager = () => (manager ??= new BleManager());

const full = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;

/**
 * UART-style service/characteristic pairs used by common BLE ELM327 adapters. Checked first;
 * anything else falls back to the first custom service with a notify and a write characteristic.
 */
const KNOWN_PROFILES = [
  // Vgate iCar Pro BLE and many clones
  { service: full("fff0"), notify: full("fff1"), write: full("fff2") },
  // HM-10 style modules
  { service: full("ffe0"), notify: full("ffe1"), write: full("ffe1") },
  // Common iOS-compatible ELM327 clones (Veepeak and others)
  {
    service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    notify: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
    write: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
  },
];

/** Generic Access/Attribute, Device Information and Battery services: never the data channel. */
const STANDARD_SERVICES = new Set(["1800", "1801", "180a", "180f"].map(full));

/** Name patterns that are probably OBD adapters, listed first when scanning. */
export const LIKELY_ADAPTER = /obd|elm|vgate|icar|veepeak|v-?link|obdlink|carista|konnwei|torque/i;

/** BLE packets carry 20 bytes of payload at the default MTU. */
const CHUNK = 20;

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (Number(Platform.Version) >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  // Android 11 and older need location permission to scan for BLE devices.
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function bluetoothReady(): Promise<boolean> {
  return (await bleManager().state()) === "PoweredOn";
}

export interface ScannedAdapter {
  id: string;
  name: string;
  rssi: number | null;
}

/** Scans for named BLE devices. Returns a function that stops the scan. */
export function scanForAdapters(onDevice: (d: ScannedAdapter) => void, onError: (e: Error) => void): () => void {
  const ble = bleManager();
  void ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) return onError(error);
    const name = device?.name ?? device?.localName;
    if (device && name) onDevice({ id: device.id, name, rssi: device.rssi });
  });
  return () => void ble.stopDeviceScan();
}

async function findChannel(device: Device): Promise<{ service: string; notify: string; write: string; withResponse: boolean }> {
  const services = await device.services();
  const chars = new Map<string, Characteristic[]>();
  for (const s of services) chars.set(s.uuid.toLowerCase(), await s.characteristics());

  const writeMode = (c: Characteristic) => (c.isWritableWithResponse ? true : c.isWritableWithoutResponse ? false : null);

  for (const p of KNOWN_PROFILES) {
    const list = chars.get(p.service);
    const notify = list?.find((c) => c.uuid.toLowerCase() === p.notify);
    const write = list?.find((c) => c.uuid.toLowerCase() === p.write);
    if (notify && write && writeMode(write) !== null) {
      return { service: p.service, notify: notify.uuid, write: write.uuid, withResponse: writeMode(write)! };
    }
  }
  for (const [service, list] of chars) {
    if (STANDARD_SERVICES.has(service)) continue;
    const notify = list.find((c) => c.isNotifiable || c.isIndicatable);
    const write = list.find((c) => writeMode(c) !== null);
    if (notify && write) return { service, notify: notify.uuid, write: write.uuid, withResponse: writeMode(write)! };
  }
  throw new Error("This device doesn't look like an OBD adapter: no serial data channel found.");
}

/** Text in and out of an ELM327 over BLE. Characteristic values are base64. */
export class BleTransport implements Transport {
  readonly simulated = false;
  private listeners = new Set<(chunk: string) => void>();
  private subscriptions: Subscription[] = [];

  private constructor(
    readonly device: Device,
    private channel: Awaited<ReturnType<typeof findChannel>>,
    onDisconnect: () => void,
  ) {
    this.subscriptions.push(
      device.monitorCharacteristicForService(channel.service, channel.notify, (error, c) => {
        if (error || !c?.value) return;
        const text = atob(c.value);
        this.listeners.forEach((l) => l(text));
      }),
      bleManager().onDeviceDisconnected(device.id, () => {
        this.subscriptions.forEach((s) => s.remove());
        onDisconnect();
      }),
    );
  }

  static async connect(deviceId: string, onDisconnect: () => void): Promise<BleTransport> {
    let device = await bleManager().connectToDevice(deviceId, { timeout: 15000 });
    device = await device.discoverAllServicesAndCharacteristics();
    try {
      return new BleTransport(device, await findChannel(device), onDisconnect);
    } catch (e) {
      await device.cancelConnection().catch(() => {});
      throw e;
    }
  }

  get name(): string {
    return this.device.name ?? this.device.localName ?? "OBD adapter";
  }

  async write(data: string): Promise<void> {
    const { service, write, withResponse } = this.channel;
    for (let i = 0; i < data.length; i += CHUNK) {
      const value = btoa(data.slice(i, i + CHUNK));
      if (withResponse) await this.device.writeCharacteristicWithResponseForService(service, write, value);
      else await this.device.writeCharacteristicWithoutResponseForService(service, write, value);
    }
  }

  onData(cb: (chunk: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async disconnect(): Promise<void> {
    this.subscriptions.forEach((s) => s.remove());
    this.listeners.clear();
    await this.device.cancelConnection().catch(() => {});
  }
}
