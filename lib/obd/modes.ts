/**
 * Parsers for the diagnostic services beyond live data: freeze frame (Mode 02), on-board
 * self-test results (Mode 06) and vehicle information (Mode 09).
 */
import { dtcFromBytes } from "./dtc-parser";
import { replyBytes } from "./pid-decoder";

/**
 * Split reply lines into messages: multi-frame CAN replies ("0:", "1:" …) are one message,
 * every other line is its own. Returns each message's bytes.
 */
export function replyMessages(lines: string[]): number[][] {
  const out: number[][] = [];
  let framed: string[] = [];
  const flush = () => {
    if (framed.length) out.push(replyBytes(framed));
    framed = [];
  };
  for (const line of lines) {
    if (/^[0-9A-F]{3}$/.test(line)) {
      flush();
      continue;
    }
    if (/^[0-9A-F]:/.test(line)) {
      // A new "0:" starts another ECU's message.
      if (line.startsWith("0:")) flush();
      framed.push(line);
    } else {
      flush();
      const b = replyBytes([line]);
      if (b.length) out.push(b);
    }
  }
  flush();
  return out;
}

// ---- Mode 02: freeze frame ----

/** The code that stored freeze frame 0, from a `020200` reply. Null when no frame is stored. */
export function parseFreezeFrameDtc(lines: string[]): string | null {
  for (const b of replyMessages(lines)) {
    if (b[0] === 0x42 && b[1] === 0x02 && b.length >= 5 && (b[3] || b[4])) return dtcFromBytes(b[3], b[4]);
  }
  return null;
}

/** Data bytes of a freeze-frame PID reply (`02 <pid> 00`). */
export function freezeFramePayload(lines: string[], pid: number): number[] | null {
  for (const b of replyMessages(lines)) {
    if (b[0] === 0x42 && b[1] === pid) return b.slice(3);
  }
  return null;
}

// ---- Mode 06: on-board monitoring test results (CAN format) ----

export interface Mode06Test {
  mid: number;
  tid: number;
  /** Component the test belongs to, e.g. "Misfire cylinder 2". */
  monitor: string;
  test: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  passed: boolean;
}

function midName(mid: number): string {
  if (mid >= 0x01 && mid <= 0x10) {
    const n = mid - 1;
    return `Oxygen sensor bank ${Math.floor(n / 4) + 1} sensor ${(n % 4) + 1}`;
  }
  if (mid >= 0x21 && mid <= 0x24) return `Catalytic converter bank ${mid - 0x20}`;
  if (mid >= 0x31 && mid <= 0x34) return `EGR system ${mid - 0x30}`;
  if (mid >= 0x35 && mid <= 0x38) return `Variable valve timing bank ${mid - 0x34}`;
  const evap: Record<number, string> = {
    0x39: "Evaporative system, cap off",
    0x3a: "Evaporative system leak (0.090\")",
    0x3b: "Evaporative system leak (0.040\")",
    0x3c: "Evaporative system leak (0.020\")",
    0x3d: "Purge flow",
  };
  if (evap[mid]) return evap[mid];
  if (mid >= 0x41 && mid <= 0x50) {
    const n = mid - 0x41;
    return `Oxygen sensor heater bank ${Math.floor(n / 4) + 1} sensor ${(n % 4) + 1}`;
  }
  if (mid >= 0x61 && mid <= 0x64) return `Heated catalyst bank ${mid - 0x60}`;
  if (mid >= 0x71 && mid <= 0x74) return `Secondary air system ${mid - 0x70}`;
  if (mid >= 0x81 && mid <= 0x84) return `Fuel system bank ${mid - 0x80}`;
  if (mid >= 0x85 && mid <= 0x88) return `Boost pressure control bank ${mid - 0x84}`;
  if (mid === 0x90 || mid === 0x91) return `NOx adsorber bank ${mid - 0x8f}`;
  if (mid === 0x98 || mid === 0x99) return `NOx catalyst bank ${mid - 0x97}`;
  if (mid === 0xa1) return "Misfire, all cylinders";
  if (mid >= 0xa2 && mid <= 0xad) return `Misfire cylinder ${mid - 0xa1}`;
  if (mid === 0xb0 || mid === 0xb1) return `Particulate filter bank ${mid - 0xaf}`;
  return `Monitor 0x${mid.toString(16).toUpperCase().padStart(2, "0")}`;
}

function testName(mid: number, tid: number): string {
  if (mid >= 0xa1 && mid <= 0xad) {
    if (tid === 0x0b) return "Misfires, average of last 10 drives";
    if (tid === 0x0c) return "Misfires, last or current drive";
  }
  const standard: Record<number, string> = {
    0x01: "Rich-to-lean threshold voltage",
    0x02: "Lean-to-rich threshold voltage",
    0x03: "Low voltage for switch time",
    0x04: "High voltage for switch time",
    0x05: "Rich-to-lean switch time",
    0x06: "Lean-to-rich switch time",
    0x07: "Minimum voltage",
    0x08: "Maximum voltage",
    0x09: "Time between transitions",
    0x0a: "Sensor period",
  };
  if (mid <= 0x10 && standard[tid]) return standard[tid];
  return `Test 0x${tid.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** Unit and scaling per Unit And Scaling ID (SAE J1979 Appendix E). Unknown IDs show raw counts. */
const UASID: Record<number, { unit: string; scale: number; offset?: number }> = {
  0x01: { unit: "", scale: 1 },
  0x02: { unit: "", scale: 0.1 },
  0x03: { unit: "", scale: 0.01 },
  0x04: { unit: "", scale: 0.001 },
  0x07: { unit: "rpm", scale: 0.25 },
  0x09: { unit: "km/h", scale: 1 },
  0x0a: { unit: "mV", scale: 0.122 },
  0x0b: { unit: "V", scale: 0.001 },
  0x0c: { unit: "V", scale: 0.01 },
  0x0d: { unit: "mA", scale: 0.00390625 },
  0x0e: { unit: "A", scale: 0.001 },
  0x10: { unit: "ms", scale: 1 },
  0x11: { unit: "ms", scale: 100 },
  0x12: { unit: "s", scale: 1 },
  0x13: { unit: "mΩ", scale: 1 },
  0x14: { unit: "Ω", scale: 1 },
  0x15: { unit: "kΩ", scale: 1 },
  0x16: { unit: "°C", scale: 0.1, offset: -40 },
  0x17: { unit: "kPa", scale: 0.01 },
  0x19: { unit: "kPa", scale: 0.079 },
  0x1a: { unit: "kPa", scale: 1 },
  0x1c: { unit: "°", scale: 0.01 },
  0x1d: { unit: "°", scale: 0.5 },
  0x22: { unit: "Hz", scale: 1 },
  0x24: { unit: "counts", scale: 1 },
  0x25: { unit: "km", scale: 1 },
  0x27: { unit: "g/s", scale: 0.01 },
  0x28: { unit: "g/s", scale: 1 },
  0x2f: { unit: "%", scale: 0.01 },
  0x81: { unit: "", scale: 1 },
  0x82: { unit: "", scale: 0.1 },
  0x83: { unit: "", scale: 0.01 },
  0x84: { unit: "", scale: 0.001 },
  0x8a: { unit: "mV", scale: 0.122 },
  0x8b: { unit: "V", scale: 0.001 },
  0x8c: { unit: "V", scale: 0.01 },
  0x8e: { unit: "A", scale: 0.001 },
  0x90: { unit: "ms", scale: 1 },
  0x96: { unit: "°C", scale: 0.1 },
  0x9c: { unit: "°", scale: 0.01 },
  0x9d: { unit: "°", scale: 0.5 },
  0xa8: { unit: "g/s", scale: 1 },
  0xaf: { unit: "%", scale: 0.01 },
  0xfc: { unit: "kPa", scale: 0.01 },
  0xfd: { unit: "kPa", scale: 0.001 },
};

/**
 * Parse a Mode 06 reply for one monitor ID. Each test is 9 bytes after the 0x46 service byte:
 * MID, TID, unit-and-scaling ID, value, min limit, max limit (each 2 bytes).
 * Pass/fail compares raw values, so it is right even when the scaling isn't known.
 */
export function parseMode06(lines: string[]): Mode06Test[] {
  const tests: Mode06Test[] = [];
  for (const b of replyMessages(lines)) {
    if (b[0] !== 0x46) continue;
    for (let i = 1; i + 9 <= b.length; i += 9) {
      const [mid, tid, uas, v1, v2, n1, n2, x1, x2] = b.slice(i, i + 9);
      // TIDs 00/20/40… are "supported tests" bitmaps, not results.
      if (tid % 0x20 === 0) continue;
      const signed = uas >= 0x80;
      const num = (h: number, l: number) => {
        const w = h * 256 + l;
        return signed && w >= 0x8000 ? w - 0x10000 : w;
      };
      const [raw, rawMin, rawMax] = [num(v1, v2), num(n1, n2), num(x1, x2)];
      const s = UASID[uas] ?? { unit: "", scale: 1 };
      const scale = (r: number) => Math.round((r * s.scale + (s.offset ?? 0)) * 1000) / 1000;
      tests.push({
        mid,
        tid,
        monitor: midName(mid),
        test: testName(mid, tid),
        value: scale(raw),
        min: scale(rawMin),
        max: scale(rawMax),
        unit: s.unit,
        passed: raw >= rawMin && raw <= rawMax,
      });
    }
  }
  return tests;
}

/** Monitor IDs the car reports from a `06 00/20/40…` reply bitmap. */
export function parseMode06Supported(lines: string[], base: number): number[] {
  const out: number[] = [];
  for (const b of replyMessages(lines)) {
    if (b[0] !== 0x46 || b[1] !== base) continue;
    for (let i = 0; i < 32; i++) if ((b[2 + Math.floor(i / 8)] ?? 0) & (0x80 >> i % 8)) out.push(base + i + 1);
  }
  return [...new Set(out)];
}

// ---- Mode 09: vehicle information ----

const isAscii = (c: number) => c >= 0x20 && c < 0x7f;

/**
 * ASCII payload of a Mode 09 info type. CAN sends one message (`49 <type> <count> data…`);
 * older buses send one line per 4 bytes (`49 <type> <seq> d d d d`).
 */
function mode09Data(lines: string[], type: number): number[] {
  const messages = replyMessages(lines).filter((b) => b[0] === 0x49 && b[1] === type);
  const legacy = messages.length > 1 && messages.every((b) => b.length === 7);
  if (legacy) return messages.sort((a, b) => a[2] - b[2]).flatMap((b) => b.slice(3));
  return messages[0]?.slice(3) ?? [];
}

const VIN_RE = /[A-HJ-NPR-Z0-9]{17}/;

export function parseVin(lines: string[]): string | null {
  const text = String.fromCharCode(...mode09Data(lines, 0x02).filter(isAscii));
  return text.match(VIN_RE)?.[0] ?? null;
}

/** Calibration IDs: 16 ASCII characters each, padded with zero bytes. */
export function parseCalibrationIds(lines: string[]): string[] {
  const data = mode09Data(lines, 0x04);
  const ids: string[] = [];
  for (let i = 0; i + 16 <= data.length; i += 16) {
    const id = String.fromCharCode(...data.slice(i, i + 16).filter(isAscii)).trim();
    if (id) ids.push(id);
  }
  return ids;
}

/** ECU name (info type 0A): 20 ASCII characters, e.g. "ECM-EngineControl". */
export function parseEcuName(lines: string[]): string | null {
  const name = String.fromCharCode(...mode09Data(lines, 0x0a).filter(isAscii))
    .replace(/\0/g, "")
    .trim();
  return name || null;
}

// ---- VIN decoding (offline, best effort) ----

const WMI: Record<string, string> = {
  MA1: "Mahindra",
  MA3: "Maruti Suzuki",
  MA6: "General Motors India",
  MA7: "Mitsubishi (India)",
  MAJ: "Ford India",
  MAK: "Honda India",
  MAL: "Hyundai India",
  MAT: "Tata Motors",
  MBH: "Nissan / Suzuki India",
  MBJ: "Toyota Kirloskar",
  MBR: "Mercedes-Benz India",
  MBV: "Volkswagen India",
  MCA: "FCA India",
  MDH: "Nissan India",
  MEE: "Renault India",
  MEX: "Skoda / Volkswagen India",
  MZB: "Kia India",
  MZD: "Kia India",
  MA8: "Kia India",
  "1FA": "Ford",
  "1G1": "Chevrolet",
  "1HG": "Honda",
  "1N4": "Nissan",
  "2HG": "Honda",
  "3VW": "Volkswagen",
  "4T1": "Toyota",
  "5YJ": "Tesla",
  JHM: "Honda",
  JMB: "Mitsubishi",
  JN1: "Nissan",
  JS2: "Suzuki",
  JT2: "Toyota",
  JTD: "Toyota",
  KMH: "Hyundai",
  KNA: "Kia",
  KND: "Kia",
  SAJ: "Jaguar",
  SAL: "Land Rover",
  TMB: "Skoda",
  VF1: "Renault",
  VF3: "Peugeot",
  VSS: "SEAT",
  WAU: "Audi",
  WBA: "BMW",
  WDD: "Mercedes-Benz",
  WDB: "Mercedes-Benz",
  WF0: "Ford Germany",
  WMW: "MINI",
  WP0: "Porsche",
  WVW: "Volkswagen",
  WV2: "Volkswagen",
  YV1: "Volvo",
  ZFA: "Fiat",
};

const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";

/** Maker and a model-year guess from the VIN. The year letter repeats every 30 years; the newer match is taken. */
export function decodeVin(vin: string, now = new Date()): { make: string | null; year: number | null } {
  const make = WMI[vin.slice(0, 3)] ?? null;
  const idx = YEAR_CODES.indexOf(vin[9]);
  if (idx < 0) return { make, year: null };
  let year = 2010 + idx;
  if (year > now.getFullYear() + 1) year -= 30;
  return { make, year };
}

/** Standard VIN check digit (position 9). Many non-North-American VINs don't use it, so treat as a hint. */
export function vinCheckDigitValid(vin: string): boolean {
  const map = "0123456789.ABCDEFGH..JKLMN.P.R..STUVWXYZ";
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const v = /[0-9]/.test(c) ? Number(c) : map.indexOf(c) % 10;
    sum += v * weights[i];
  }
  const check = sum % 11 === 10 ? "X" : String(sum % 11);
  return vin[8] === check;
}
