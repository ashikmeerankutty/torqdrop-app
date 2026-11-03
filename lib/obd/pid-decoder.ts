/**
 * Turn cleaned ELM327 reply lines into data bytes after the `41 <pid>` header.
 * Handles single-frame replies and multi-frame ("0:" / "1:" prefixed) replies.
 */
export function replyBytes(lines: string[]): number[] {
  const bytes: number[] = [];
  for (const line of lines) {
    // Multi-frame: a lone byte-count line like "00A" precedes "0: 41 .." lines.
    if (/^[0-9A-F]{3}$/.test(line)) continue;
    const body = line.replace(/^[0-9A-F]:/, "").replace(/\s+/g, "");
    if (!/^[0-9A-F]+$/.test(body) || body.length % 2 !== 0) continue;
    for (let i = 0; i < body.length; i += 2) bytes.push(parseInt(body.slice(i, i + 2), 16));
  }
  return bytes;
}

/** Find the payload of a Mode 01 reply for `pid`, or null if no matching line is present. */
export function mode01Payload(lines: string[], pid: number): number[] | null {
  return mode01Payloads(lines, pid)[0] ?? null;
}

/**
 * Payloads of every Mode 01 reply line for `pid`. On CAN several ECUs (engine, gearbox, hybrid)
 * may each answer the same request; with headers off their lines are indistinguishable.
 */
export function mode01Payloads(lines: string[], pid: number): number[][] {
  const out: number[][] = [];
  for (const line of lines) {
    const bytes = replyBytes([line]);
    if (bytes[0] === 0x41 && bytes[1] === pid) out.push(bytes.slice(2));
  }
  return out;
}

export type PidCategory = "engine" | "fuel" | "air" | "emissions" | "electrical" | "distance" | "temperature" | "diesel";

export const CATEGORY_LABEL: Record<PidCategory, string> = {
  engine: "Engine",
  fuel: "Fuel",
  air: "Air and boost",
  temperature: "Temperatures",
  emissions: "Emissions",
  diesel: "Diesel",
  electrical: "Electrical",
  distance: "Distance and time",
};

export interface PidDef {
  pid: number;
  name: string;
  /** Short label for gauges and chips. */
  short: string;
  unit: string;
  /** Data bytes the reply must carry; shorter replies are ignored. */
  bytes: number;
  decode: (b: number[]) => number;
  /** Gauge scale. */
  min: number;
  max: number;
  decimals: number;
  category: PidCategory;
}

const word = (a: number, b: number) => a * 256 + b;
const signedWord = (a: number, b: number) => {
  const w = word(a, b);
  return w >= 0x8000 ? w - 0x10000 : w;
};
const pct = (a: number) => (a * 100) / 255;
const trim = (a: number) => ((a - 128) * 100) / 128;

function def(
  pid: number,
  name: string,
  short: string,
  unit: string,
  bytes: number,
  decode: (b: number[]) => number,
  range: [number, number],
  decimals: number,
  category: PidCategory,
): PidDef {
  return { pid, name, short, unit, bytes, decode, min: range[0], max: range[1], decimals, category };
}

/**
 * Standard SAE J1979 Mode 01 PIDs. Keys are stable: they're stored in dashboards and trips and sent to the AI.
 * Ranges are display ranges for gauges, not the protocol limits.
 */
export const PIDS = {
  engineLoad: def(0x04, "Engine load", "Load", "%", 1, ([a]) => pct(a), [0, 100], 0, "engine"),
  coolantTemp: def(0x05, "Coolant temperature", "Coolant", "°C", 1, ([a]) => a - 40, [-20, 130], 0, "temperature"),
  shortFuelTrim1: def(0x06, "Short-term fuel trim B1", "STFT B1", "%", 1, ([a]) => trim(a), [-25, 25], 1, "fuel"),
  longFuelTrim1: def(0x07, "Long-term fuel trim B1", "LTFT B1", "%", 1, ([a]) => trim(a), [-25, 25], 1, "fuel"),
  shortFuelTrim2: def(0x08, "Short-term fuel trim B2", "STFT B2", "%", 1, ([a]) => trim(a), [-25, 25], 1, "fuel"),
  longFuelTrim2: def(0x09, "Long-term fuel trim B2", "LTFT B2", "%", 1, ([a]) => trim(a), [-25, 25], 1, "fuel"),
  fuelPressure: def(0x0a, "Fuel pressure", "Fuel press.", "kPa", 1, ([a]) => a * 3, [0, 765], 0, "fuel"),
  map: def(0x0b, "Intake manifold pressure", "MAP", "kPa", 1, ([a]) => a, [0, 255], 0, "air"),
  rpm: def(0x0c, "Engine speed", "RPM", "rpm", 2, ([a, b]) => word(a, b) / 4, [0, 8000], 0, "engine"),
  speed: def(0x0d, "Vehicle speed", "Speed", "km/h", 1, ([a]) => a, [0, 220], 0, "engine"),
  timingAdvance: def(0x0e, "Timing advance", "Timing", "°", 1, ([a]) => a / 2 - 64, [-20, 60], 1, "engine"),
  intakeTemp: def(0x0f, "Intake air temperature", "Intake", "°C", 1, ([a]) => a - 40, [-20, 90], 0, "temperature"),
  maf: def(0x10, "Mass air flow", "MAF", "g/s", 2, ([a, b]) => word(a, b) / 100, [0, 250], 1, "air"),
  throttle: def(0x11, "Throttle position", "Throttle", "%", 1, ([a]) => pct(a), [0, 100], 0, "engine"),
  o2VoltageB1S1: def(0x14, "O2 sensor B1S1 voltage", "O2 B1S1", "V", 2, ([a]) => a / 200, [0, 1.275], 2, "emissions"),
  o2VoltageB1S2: def(0x15, "O2 sensor B1S2 voltage", "O2 B1S2", "V", 2, ([a]) => a / 200, [0, 1.275], 2, "emissions"),
  runTime: def(0x1f, "Run time since engine start", "Run time", "s", 2, ([a, b]) => word(a, b), [0, 7200], 0, "distance"),
  distanceWithMil: def(0x21, "Distance driven with check-engine light on", "Dist. MIL on", "km", 2, ([a, b]) => word(a, b), [0, 1000], 0, "distance"),
  fuelRailPressure: def(0x22, "Fuel rail pressure (vacuum ref.)", "Rail press.", "kPa", 2, ([a, b]) => word(a, b) * 0.079, [0, 5000], 0, "fuel"),
  fuelRailGauge: def(0x23, "Fuel rail pressure", "Rail press.", "kPa", 2, ([a, b]) => word(a, b) * 10, [0, 200000], 0, "fuel"),
  lambdaB1S1: def(0x24, "Wide-band O2 B1S1 (lambda)", "Lambda", "λ", 4, ([a, b]) => (2 / 65536) * word(a, b), [0.5, 1.5], 3, "emissions"),
  commandedEgr: def(0x2c, "Commanded EGR", "EGR", "%", 1, ([a]) => pct(a), [0, 100], 0, "emissions"),
  egrError: def(0x2d, "EGR error", "EGR error", "%", 1, ([a]) => trim(a), [-100, 100], 0, "emissions"),
  evapPurge: def(0x2e, "Commanded evaporative purge", "Purge", "%", 1, ([a]) => pct(a), [0, 100], 0, "emissions"),
  fuelLevel: def(0x2f, "Fuel tank level", "Fuel", "%", 1, ([a]) => pct(a), [0, 100], 0, "fuel"),
  warmUpsSinceClear: def(0x30, "Warm-ups since codes cleared", "Warm-ups", "", 1, ([a]) => a, [0, 255], 0, "distance"),
  distanceSinceClear: def(0x31, "Distance since codes cleared", "Since clear", "km", 2, ([a, b]) => word(a, b), [0, 10000], 0, "distance"),
  baroPressure: def(0x33, "Barometric pressure", "Baro", "kPa", 1, ([a]) => a, [60, 110], 0, "air"),
  catTempB1S1: def(0x3c, "Catalyst temperature B1S1", "Cat temp", "°C", 2, ([a, b]) => word(a, b) / 10 - 40, [0, 1000], 0, "temperature"),
  catTempB2S1: def(0x3d, "Catalyst temperature B2S1", "Cat B2", "°C", 2, ([a, b]) => word(a, b) / 10 - 40, [0, 1000], 0, "temperature"),
  moduleVoltage: def(0x42, "Control module voltage", "Voltage", "V", 2, ([a, b]) => word(a, b) / 1000, [8, 16], 1, "electrical"),
  absoluteLoad: def(0x43, "Absolute load", "Abs. load", "%", 2, ([a, b]) => (word(a, b) * 100) / 255, [0, 200], 0, "engine"),
  commandedLambda: def(0x44, "Commanded air-fuel ratio (lambda)", "Cmd λ", "λ", 2, ([a, b]) => (2 / 65536) * word(a, b), [0.5, 1.5], 3, "fuel"),
  relativeThrottle: def(0x45, "Relative throttle position", "Rel. throttle", "%", 1, ([a]) => pct(a), [0, 100], 0, "engine"),
  ambientTemp: def(0x46, "Outside air temperature", "Outside", "°C", 1, ([a]) => a - 40, [-20, 55], 0, "temperature"),
  pedalD: def(0x49, "Accelerator pedal position", "Pedal", "%", 1, ([a]) => pct(a), [0, 100], 0, "engine"),
  commandedThrottle: def(0x4c, "Commanded throttle actuator", "Cmd throttle", "%", 1, ([a]) => pct(a), [0, 100], 0, "engine"),
  timeWithMil: def(0x4d, "Time run with check-engine light on", "Time MIL on", "min", 2, ([a, b]) => word(a, b), [0, 1000], 0, "distance"),
  timeSinceClear: def(0x4e, "Time since codes cleared", "Time since clear", "min", 2, ([a, b]) => word(a, b), [0, 10000], 0, "distance"),
  ethanol: def(0x52, "Ethanol fuel percentage", "Ethanol", "%", 1, ([a]) => pct(a), [0, 100], 0, "fuel"),
  hybridBattery: def(0x5b, "Hybrid battery remaining", "Hybrid batt.", "%", 1, ([a]) => pct(a), [0, 100], 0, "electrical"),
  oilTemp: def(0x5c, "Engine oil temperature", "Oil temp", "°C", 1, ([a]) => a - 40, [-20, 150], 0, "temperature"),
  injectionTiming: def(0x5d, "Fuel injection timing", "Inj. timing", "°", 2, ([a, b]) => word(a, b) / 128 - 210, [-30, 30], 1, "fuel"),
  fuelRate: def(0x5e, "Engine fuel rate", "Fuel rate", "L/h", 2, ([a, b]) => word(a, b) / 20, [0, 30], 1, "fuel"),
  demandTorque: def(0x61, "Driver's demand torque", "Demand torque", "%", 1, ([a]) => a - 125, [-50, 100], 0, "engine"),
  actualTorque: def(0x62, "Actual engine torque", "Torque", "%", 1, ([a]) => a - 125, [-50, 100], 0, "engine"),
  referenceTorque: def(0x63, "Engine reference torque", "Ref. torque", "Nm", 2, ([a, b]) => word(a, b), [0, 1000], 0, "engine"),
  dpfDeltaPressure: def(0x7a, "Particulate filter pressure difference", "DPF Δp", "kPa", 3, ([, b, c]) => signedWord(b, c) / 100, [-5, 50], 2, "diesel"),
  dpfInletTemp: def(0x7c, "Particulate filter inlet temperature", "DPF temp", "°C", 3, ([, b, c]) => word(b, c) / 10 - 40, [0, 800], 0, "diesel"),
  odometer: def(0xa6, "Odometer", "Odometer", "km", 4, ([a, b, c, d]) => (((a * 256 + b) * 256 + c) * 256 + d) / 10, [0, 999999], 0, "distance"),
} satisfies Record<string, PidDef>;

export type PidKey = keyof typeof PIDS;
export const PID_KEYS = Object.keys(PIDS) as PidKey[];

export function isPidKey(k: string): k is PidKey {
  return k in PIDS;
}

export function decodePid(def: PidDef, payload: number[]): number {
  return Math.round(def.decode(payload) * 1000) / 1000;
}

/** Readable label for an evidence ref: a PID key, "mil", or a trouble code (returned as-is). */
export function evidenceLabel(ref: string): string {
  if (ref === "mil") return "Check-engine light";
  return isPidKey(ref) ? PIDS[ref].name : ref;
}

/** Format a reading with the PID's precision. */
export function formatPid(key: PidKey, value: number): string {
  return value.toFixed(PIDS[key].decimals);
}

/** PID 01: MIL state and stored DTC count. */
export function decodeMonitorStatus([a]: number[]): { milOn: boolean; dtcCount: number } {
  return { milOn: (a & 0x80) !== 0, dtcCount: a & 0x7f };
}

export interface ReadinessMonitor {
  key: string;
  name: string;
  /** False while the ECU still has to run this self-test since codes were last cleared. */
  complete: boolean;
}

export interface Readiness {
  milOn: boolean;
  dtcCount: number;
  ignition: "spark" | "compression";
  monitors: ReadinessMonitor[];
}

const SPARK_MONITORS = [
  ["catalyst", "Catalytic converter"],
  ["heatedCatalyst", "Heated catalyst"],
  ["evap", "Evaporative system"],
  ["secondaryAir", "Secondary air"],
  ["acRefrigerant", "A/C refrigerant"],
  ["o2Sensor", "Oxygen sensors"],
  ["o2Heater", "Oxygen sensor heaters"],
  ["egr", "EGR / VVT"],
] as const;

const COMPRESSION_MONITORS = [
  ["nmhcCatalyst", "NMHC catalyst"],
  ["noxScr", "NOx / SCR aftertreatment"],
  null,
  ["boostPressure", "Boost pressure"],
  null,
  ["exhaustSensor", "Exhaust gas sensor"],
  ["pmFilter", "Particulate filter"],
  ["egr", "EGR / VVT"],
] as const;

const CONTINUOUS_MONITORS = [
  ["misfire", "Misfire"],
  ["fuelSystem", "Fuel system"],
  ["components", "Comprehensive components"],
] as const;

/**
 * PID 01 in full: MIL, code count and the readiness monitors. A monitor is listed only if the car
 * has it; `complete: false` means the self-test hasn't finished since codes were last cleared.
 */
export function decodeReadiness([a, b, c, d]: number[]): Readiness {
  const ignition = b & 0x08 ? "compression" : "spark";
  const monitors: ReadinessMonitor[] = [];
  CONTINUOUS_MONITORS.forEach(([key, name], i) => {
    if (b & (1 << i)) monitors.push({ key, name, complete: (b & (0x10 << i)) === 0 });
  });
  const table = ignition === "spark" ? SPARK_MONITORS : COMPRESSION_MONITORS;
  table.forEach((entry, i) => {
    if (!entry) return;
    if (c & (1 << i)) monitors.push({ key: entry[0], name: entry[1], complete: (d & (1 << i)) === 0 });
  });
  return { ...decodeMonitorStatus([a]), ignition, monitors };
}

/**
 * "Supported PIDs" bitmap (PIDs 00/20/40...): returns the PIDs the vehicle reports as supported.
 * `base` is the request PID (0x00, 0x20, ...).
 */
export function decodeSupportedPids(base: number, payload: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = payload[Math.floor(i / 8)] ?? 0;
    if (byte & (0x80 >> i % 8)) out.push(base + i + 1);
  }
  return out;
}

/** PID 51. */
export const FUEL_TYPES: Record<number, string> = {
  1: "Petrol",
  2: "Methanol",
  3: "Ethanol",
  4: "Diesel",
  5: "LPG",
  6: "CNG",
  8: "Electric",
  9: "Bi-fuel petrol",
  12: "Bi-fuel LPG",
  13: "Bi-fuel CNG",
  17: "Hybrid petrol",
  18: "Hybrid ethanol",
  19: "Hybrid diesel",
  20: "Hybrid electric",
};
