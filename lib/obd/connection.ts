import { useSyncExternalStore } from "react";

import { recordAdapterSession } from "@/lib/firebase/adapter-sessions";
import {
  type AdapterCarInfo,
  createVehicleFromAdapter,
  getVehicle,
  mergeVehicle,
  moveTrips,
  updateVehicle,
  type Vehicle,
  vehicleForConnection,
  type VehicleMatch,
} from "@/lib/garage/vehicles";

import { startAlerts } from "./alerts";
import { BleTransport, bluetoothReady, requestBlePermissions, scanForAdapters, type ScannedAdapter } from "./ble-transport";
import { ObdCommandError } from "./elm327";
import { addDemand, demandedIntervals, live, type LiveKey, onDemandChange } from "./live";
import { gearLearner, setMetricsVehicle } from "./metrics";
import { MockTransport } from "./mock-transport";
import type { Mode06Test } from "./modes";
import { PID_KEYS, type PidKey, PIDS, type Readiness } from "./pid-decoder";
import { type DtcReading, type FreezeFrame, ObdSession, type VehicleInfo } from "./session";
import { createSimulatedCar } from "./simulated-car";
import { SnapshotBuilder } from "./snapshot-builder";
import { startTripRecorder } from "./trip-recorder";

/** Values read in the background whenever connected: what trips, alerts, the health card and AI insights need. */
const BASELINE: { keys: LiveKey[]; intervalMs: number }[] = [
  { keys: ["rpm", "speed", "throttle", "fuelRate", "maf", "map", "intakeTemp"], intervalMs: 1000 },
  { keys: ["coolantTemp", "moduleVoltage", "shortFuelTrim1", "longFuelTrim1", "engineLoad"], intervalMs: 3000 },
  { keys: ["fuelLevel", "oilTemp", "ambientTemp", "baroPressure", "batteryVoltage"], intervalMs: 15_000 },
  { keys: ["odometer", "distanceSinceClear", "runTime"], intervalMs: 60_000 },
];

/** PIDs fed to the AI insight snapshot. */
const SNAPSHOT_KEYS = new Set<LiveKey>(["rpm", "speed", "coolantTemp", "throttle", "shortFuelTrim1", "longFuelTrim1", "intakeTemp", "maf", "moduleVoltage", "engineLoad", "map", "fuelRate", "oilTemp"]);

export type ObdStatus = "idle" | "scanning" | "connecting" | "connected" | "disconnected" | "error";

export interface ObdState {
  status: ObdStatus;
  /** What the connection is doing right now, e.g. "Talking to the car…". */
  step?: string;
  error?: string;
  devices: ScannedAdapter[];
  adapterName?: string;
  simulated: boolean;
  protocol?: string | null;
  /**
   * Last value per value, refreshed about once a second for screens that don't need gauge speed.
   * null means the vehicle doesn't support it; missing means not read yet. Gauges use `useLive`/`useMetric`.
   */
  live: Partial<Record<LiveKey, number | null>>;
  mil?: { milOn: boolean; dtcCount: number };
  readiness?: Readiness;
  dtcs?: DtcReading & { readAt: number };
  info?: VehicleInfo;
  /** Garage entry for the connected car. Never set for the simulated car, which isn't saved. */
  vehicleId?: string;
  /** How that entry was found, so the Garage can ask when it was a guess. */
  vehicleMatch?: VehicleMatch;
  connectedAt?: number;
  /** Supported PIDs, so screens can list what this car offers. */
  supportedKeys: PidKey[];
}

const DTC_EVERY_MS = 30_000;
const READINESS_EVERY_MS = 5_000;
const LIVE_FLUSH_MS = 1000;

let state: ObdState = { status: "idle", devices: [], simulated: false, live: {}, supportedKeys: [] };
const listeners = new Set<() => void>();
let session: ObdSession | null = null;
let stopScan: (() => void) | null = null;
/** Bumped on every connect/disconnect so a stale poll loop stops. */
let generation = 0;
let snapshot: SnapshotBuilder | null = null;
let stopServices: (() => void)[] = [];

function set(patch: Partial<ObdState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getObdState(): ObdState {
  return state;
}

export function useObd(): ObdState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Rolling summary of recent readings, for the AI insight feed. */
export function getSnapshotBuilder(): SnapshotBuilder | null {
  return snapshot;
}

function describeError(e: unknown): string {
  if (e instanceof ObdCommandError) {
    if (e.code === "UNABLE_TO_CONNECT") return "The adapter can't reach the car. Turn the ignition on (or start the engine) and try again.";
    if (e.code === "TIMEOUT") return "The adapter stopped answering. Check it's plugged in firmly.";
    if (e.code === "BUS_ERROR") return "The adapter reported a bus error talking to the car.";
  }
  return e instanceof Error ? e.message : "Something went wrong talking to the adapter.";
}

export async function startScan() {
  stopScanning();
  if (!(await requestBlePermissions())) {
    return set({ status: "error", error: "Bluetooth permission is needed to find the adapter." });
  }
  if (!(await bluetoothReady())) {
    return set({ status: "error", error: "Turn on Bluetooth and try again." });
  }
  set({ status: "scanning", devices: [], error: undefined });
  stopScan = scanForAdapters(
    (d) => {
      if (state.devices.some((x) => x.id === d.id)) return;
      set({ devices: [...state.devices, d] });
    },
    (e) => set({ status: "error", error: e.message }),
  );
  // Scanning drains the battery; stop after 20 s.
  setTimeout(() => {
    if (state.status === "scanning") {
      stopScanning();
      set({ status: "idle" });
    }
  }, 20_000);
}

export function stopScanning() {
  stopScan?.();
  stopScan = null;
}

async function start(open: () => Promise<{ session: ObdSession; name: string }>) {
  stopScanning();
  await disconnect();
  const gen = ++generation;
  set({
    status: "connecting",
    step: "Connecting to the adapter…",
    error: undefined,
    live: {},
    mil: undefined,
    readiness: undefined,
    dtcs: undefined,
    info: undefined,
    vehicleId: undefined,
    vehicleMatch: undefined,
    supportedKeys: [],
  });
  setMetricsVehicle(null);
  adapterCar = null;
  try {
    const opened = await open();
    if (gen !== generation) return void opened.session.close();
    const s = (session = opened.session);
    snapshot = new SnapshotBuilder({ simulated: s.simulated });
    live.reset();
    const supportedKeys = PID_KEYS.filter((k) => s.isSupported(k));
    for (const key of PID_KEYS) {
      if (!s.isSupported(key)) {
        live.set(key, null);
        if (SNAPSHOT_KEYS.has(key)) snapshot.markUnsupported(key);
      }
    }
    set({
      status: "connected",
      step: undefined,
      adapterName: opened.name,
      simulated: s.simulated,
      protocol: s.protocol,
      supportedKeys,
      live: live.snapshot(),
      connectedAt: Date.now(),
    });
    recordAdapterSession({
      adapterModel: opened.name,
      protocol: s.protocol,
      supportedPids: [...s.supported],
      simulated: s.simulated,
    });
    stopServices = [...BASELINE.map((b) => addDemand(b.keys, b.intervalMs)), startTripRecorder(s.simulated), startAlerts(() => state.mil?.milOn ?? false)];
    void identifyVehicle(gen, s);
    void poll(gen, s);
  } catch (e) {
    if (gen === generation) set({ status: "error", step: undefined, error: describeError(e) });
  }
}

/** The simulated car's profile. Kept in memory only, so it never shows up in the garage. */
const SIMULATED_VEHICLE: Vehicle = {
  id: "simulated",
  vin: null,
  name: "Simulated car",
  make: "Maruti Suzuki",
  model: "Swift",
  year: 2025,
  fuel: "petrol",
  displacementL: 1.2,
  weightKg: 900,
  redlineRpm: 6500,
  tankL: 37,
  odometerKm: null,
  odometerAt: null,
  ecuInfo: null,
  gears: null,
  createdAt: 0,
};

/** What the adapter reported about the connected car, kept for relinking. */
let adapterCar: AdapterCarInfo | null = null;

/** Read the VIN and ECU details once, and match the car to the garage. */
async function identifyVehicle(gen: number, s: ObdSession) {
  let info: VehicleInfo = { vin: null, calibrationIds: [], ecuName: null, fuelType: null };
  try {
    info = await s.readVehicleInfo();
  } catch (e) {
    // Still link the car: it just can't be recognised by VIN or software.
    console.warn("vehicle info read failed", e);
  }
  if (gen !== generation) return;
  set({ info });
  if (s.simulated) return setMetricsVehicle(SIMULATED_VEHICLE);
  adapterCar = { ...info, pids: [...s.supported].sort((a, b) => a - b).map((p) => p.toString(16).padStart(2, "0")).join("") };
  try {
    const { vehicle, match } = await vehicleForConnection(adapterCar);
    if (gen !== generation) return;
    link(vehicle, match);
  } catch (e) {
    console.warn("vehicle identification failed", e);
  }
}

function link(vehicle: Vehicle, match: VehicleMatch) {
  setMetricsVehicle(vehicle);
  set({ vehicleId: vehicle.id, vehicleMatch: match });
}

/** The person says the matched car is right. */
export function confirmConnectedCar() {
  if (state.vehicleId) set({ vehicleMatch: "confirmed" });
}

/** The connected car is a different one from the garage entry it was matched to: add it as a new car. */
export async function connectedCarIsNew(): Promise<string | null> {
  const wrongId = state.vehicleId;
  if (!adapterCar || !wrongId) return null;
  const v = await createVehicleFromAdapter(adapterCar);
  // Undo the match: the wrong car loses this car's fingerprint and today's trips.
  await updateVehicle(wrongId, { ecuInfo: null });
  await moveTrips(wrongId, v.id, state.connectedAt ?? Date.now());
  link(v, "confirmed");
  return v.id;
}

/** The connected car is already in the garage as `targetId`. */
export async function connectedCarIs(targetId: string) {
  const current = state.vehicleId;
  if (!adapterCar || !current || current === targetId) return;
  if (state.vehicleMatch === "new") {
    // The entry was made for this connection: fold it into the right car.
    await mergeVehicle(current, targetId);
  } else {
    await updateVehicle(current, { ecuInfo: null });
    await moveTrips(current, targetId, state.connectedAt ?? Date.now());
    await updateVehicle(targetId, { ecuInfo: { calibrationIds: adapterCar.calibrationIds, ecuName: adapterCar.ecuName, pids: adapterCar.pids } });
  }
  const v = await getVehicle(targetId);
  if (v) link(v, "confirmed");
}

/** Call after deleting a car, so the connection stops writing to it. */
export function detachVehicle(id: string) {
  if (state.vehicleId !== id) return;
  setMetricsVehicle(null);
  set({ vehicleId: undefined, vehicleMatch: undefined });
}

export function connectAdapter(device: ScannedAdapter) {
  return start(async () => {
    const transport = await BleTransport.connect(device.id, () => onTransportLost());
    set({ step: "Talking to the car…" });
    return { session: await ObdSession.open(transport), name: transport.name };
  });
}

export function connectSimulated() {
  return start(async () => ({
    // ~35 ms per reply, close to a good BLE adapter.
    session: await ObdSession.open(new MockTransport(createSimulatedCar(), 35)),
    name: "Simulated car",
  }));
}

function stopAll() {
  stopServices.forEach((s) => s());
  stopServices = [];
  // Keep what was learned about the gears for next time.
  const gears = gearLearner.gears();
  if (state.vehicleId && gears.length >= 2 && !state.simulated) void updateVehicle(state.vehicleId, { gears });
}

function onTransportLost() {
  if (state.status !== "connected") return;
  generation++;
  session = null;
  stopAll();
  set({ status: "disconnected", error: "The adapter disconnected. Check it's still plugged in and the car is on." });
}

export async function disconnect() {
  generation++;
  const s = session;
  session = null;
  snapshot = null;
  stopAll();
  if (state.status === "connected" || state.status === "connecting") set({ status: "idle" });
  await s?.close().catch(() => {});
}

function requireSession(): ObdSession {
  if (!session) throw new Error("Connect an OBD adapter first.");
  return session;
}

/** Reads stored and pending codes plus the MIL now. Usable from the PPI ECU-scan check. */
export async function readCodes(): Promise<{ dtcs: DtcReading; mil: { milOn: boolean; dtcCount: number } | null; simulated: boolean; protocol: string | null }> {
  const s = requireSession();
  const dtcs = await s.readDtcs();
  const readiness = await s.readReadiness();
  const mil = readiness ? { milOn: readiness.milOn, dtcCount: readiness.dtcCount } : null;
  snapshot?.setDtcs(dtcs.stored, dtcs.pending);
  if (mil) snapshot?.setMil(mil.milOn, mil.dtcCount);
  set({ dtcs: { ...dtcs, readAt: Date.now() }, ...(readiness && mil ? { mil, readiness } : {}) });
  return { dtcs, mil, simulated: s.simulated, protocol: s.protocol };
}

/** Mode 04. The caller must have confirmed with the user. Never offered during a PPI. */
export async function clearCodes() {
  await requireSession().clearDtcs();
  await readCodes();
}

export const readFreezeFrame = (): Promise<FreezeFrame | null> => requireSession().readFreezeFrame();
export const readMode06 = (): Promise<Mode06Test[] | null> => requireSession().readMode06();
export const readPermanentCodes = (): Promise<string[]> => requireSession().readPermanentDtcs();

/** Read one value right now, outside the schedule (battery test, inspection snapshot). */
export async function readNow(key: LiveKey): Promise<number | null> {
  const s = requireSession();
  const v = key === "batteryVoltage" ? await s.readAdapterVoltage() : await s.readPid(key);
  live.set(key, v);
  return v;
}

async function readValue(s: ObdSession, key: LiveKey): Promise<number | null> {
  return key === "batteryVoltage" ? s.readAdapterVoltage() : s.readPid(key);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Earliest-deadline-first polling: each value is due `interval` after its last read, and the most
 * overdue one is read next. Fast gauges get most of the adapter's bandwidth while slow values still
 * come round. Codes and readiness are read on their own timers.
 */
async function poll(gen: number, s: ObdSession) {
  let lastDtcRead = 0;
  let lastReadiness = 0;
  let lastFlush = 0;
  let failures = 0;
  let intervals = demandedIntervals();
  const offDemand = onDemandChange(() => {
    intervals = demandedIntervals();
  });
  const lastRead = new Map<LiveKey, number>();
  const isPollable = (k: LiveKey) => k === "batteryVoltage" || s.isSupported(k);

  try {
    while (gen === generation) {
      try {
        const now = Date.now();
        if (now - lastDtcRead > DTC_EVERY_MS) {
          lastDtcRead = lastReadiness = now;
          await readCodes();
        } else if (now - lastReadiness > READINESS_EVERY_MS) {
          lastReadiness = now;
          const readiness = await s.readReadiness();
          if (readiness && gen === generation) {
            const mil = { milOn: readiness.milOn, dtcCount: readiness.dtcCount };
            snapshot?.setMil(mil.milOn, mil.dtcCount);
            set({ mil, readiness });
          }
        }

        let next: LiveKey | null = null;
        let nextDue = Infinity;
        for (const [key, interval] of intervals) {
          if (!isPollable(key)) continue;
          const due = (lastRead.get(key) ?? 0) + interval;
          if (due < nextDue) [next, nextDue] = [key, due];
        }
        if (!next) {
          await sleep(200);
          continue;
        }
        if (nextDue > Date.now()) {
          await sleep(Math.min(nextDue - Date.now(), 100));
          continue;
        }
        lastRead.set(next, Date.now());
        const value = await readValue(s, next);
        if (gen !== generation) return;
        live.set(next, value);
        if (value !== null && SNAPSHOT_KEYS.has(next) && next !== "batteryVoltage") snapshot?.addReading(next, PIDS[next as PidKey].unit, value);
        if (next === "speed" || next === "rpm") {
          const [speed, rpm] = [live.get("speed"), live.get("rpm")];
          if (typeof speed === "number" && typeof rpm === "number") gearLearner.feed(speed, rpm, live.get("throttle"));
        }
        if (Date.now() - lastFlush > LIVE_FLUSH_MS) {
          lastFlush = Date.now();
          set({ live: live.snapshot() });
        }
        failures = 0;
      } catch (e) {
        // A single timeout can be a busy bus; three in a row means the adapter is gone.
        if (++failures >= 3 && gen === generation) {
          generation++;
          session = null;
          stopAll();
          await s.close().catch(() => {});
          return set({ status: "disconnected", error: describeError(e) });
        }
        await sleep(200);
      }
    }
  } finally {
    offDemand();
  }
}
