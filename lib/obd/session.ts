import { parseDtcReply } from "./dtc-parser";
import { Elm327, ObdCommandError } from "./elm327";
import {
  freezeFramePayload,
  type Mode06Test,
  parseCalibrationIds,
  parseEcuName,
  parseFreezeFrameDtc,
  parseMode06,
  parseMode06Supported,
  parseVin,
} from "./modes";
import {
  decodePid,
  decodeReadiness,
  decodeSupportedPids,
  FUEL_TYPES,
  mode01Payload,
  mode01Payloads,
  PIDS,
  type PidKey,
  type Readiness,
} from "./pid-decoder";
import type { Transport } from "./transport";

export type { PidKey } from "./pid-decoder";

export interface DtcReading {
  stored: string[];
  pending: string[];
}

export interface FreezeFrame {
  /** The code that made the ECU save this snapshot. */
  dtc: string;
  values: Partial<Record<PidKey, number>>;
}

export interface VehicleInfo {
  vin: string | null;
  calibrationIds: string[];
  ecuName: string | null;
  fuelType: string | null;
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** ELM327 protocol numbers 6–C are CAN, which adds a count byte to DTC replies. */
const CAN_PROTOCOLS = new Set(["6", "7", "8", "9", "A", "B", "C"]);

const isNoData = (e: unknown) => e instanceof ObdCommandError && e.code === "NO_DATA";

/** PIDs read for the freeze frame: the ones a mechanic looks at first. */
const FREEZE_FRAME_KEYS: PidKey[] = [
  "engineLoad",
  "coolantTemp",
  "shortFuelTrim1",
  "longFuelTrim1",
  "map",
  "rpm",
  "speed",
  "timingAdvance",
  "intakeTemp",
  "maf",
  "throttle",
  "runTime",
  "moduleVoltage",
];

/**
 * One connection to a vehicle through an ELM327 adapter: init, protocol detection,
 * supported-PID discovery, then reads. Unsupported PIDs read as null, never as zero.
 */
export class ObdSession {
  /** ELM327 protocol number, e.g. "6" for ISO 15765-4 CAN 11-bit 500 kbaud. */
  protocol: string | null = null;
  readonly supported = new Set<number>();
  /**
   * On CAN, asking for exactly one reply ("010C1") stops the adapter waiting for more ECUs,
   * roughly doubling the live-data rate. Turned off if the adapter doesn't understand it.
   */
  private singleReply = true;

  private constructor(
    private elm: Elm327,
    readonly simulated: boolean,
  ) {}

  static async open(transport: Transport): Promise<ObdSession> {
    const elm = new Elm327(transport);
    const session = new ObdSession(elm, transport.simulated);
    try {
      await elm.init();
      await session.discover();
    } catch (e) {
      await elm.close().catch(() => {});
      throw e;
    }
    return session;
  }

  get canFramed(): boolean {
    return this.protocol === null || CAN_PROTOCOLS.has(this.protocol);
  }

  private async discover() {
    // The first request makes an auto-protocol adapter search the bus, which can take several seconds.
    // UNABLE TO CONNECT here usually means the ignition is off.
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0]) {
      if (base !== 0x00 && !this.supported.has(base)) break;
      let lines: string[];
      try {
        lines = await this.elm.send(`01${hex(base)}`, { timeoutMs: base === 0x00 ? 12000 : undefined });
      } catch (e) {
        if (base !== 0x00 && isNoData(e)) break;
        throw e;
      }
      // Each ECU answers with its own bitmap; a PID counts as supported if any of them has it,
      // otherwise a gearbox reply arriving first hides the engine's fuel trims.
      const payloads = mode01Payloads(lines, base);
      if (payloads.length === 0) break;
      for (const payload of payloads) decodeSupportedPids(base, payload).forEach((p) => this.supported.add(p));
    }
    const [dpn] = await this.elm.send("ATDPN").catch(() => [] as string[]);
    this.protocol = dpn ? dpn.replace(/^A/, "").slice(0, 1) : null;
  }

  isSupported(key: PidKey): boolean {
    return this.supported.has(PIDS[key].pid);
  }

  /** Current value, or null if the vehicle doesn't support the PID or didn't answer. */
  async readPid(key: PidKey): Promise<number | null> {
    const def = PIDS[key];
    if (!this.supported.has(def.pid)) return null;
    const fast = this.singleReply && this.protocol !== null && CAN_PROTOCOLS.has(this.protocol);
    try {
      const payload = mode01Payload(await this.elm.send(`01${hex(def.pid)}${fast ? "1" : ""}`), def.pid);
      return payload && payload.length >= def.bytes ? decodePid(def, payload) : null;
    } catch (e) {
      if (isNoData(e)) return null;
      if (fast && e instanceof ObdCommandError && e.code === "UNKNOWN_COMMAND") {
        this.singleReply = false;
        return this.readPid(key);
      }
      throw e;
    }
  }

  /** Battery voltage measured by the adapter at the OBD port (ATRV). Works on every car, engine on or off. */
  async readAdapterVoltage(): Promise<number | null> {
    try {
      const [line] = await this.elm.send("ATRV");
      const v = parseFloat(line ?? "");
      return Number.isFinite(v) ? v : null;
    } catch (e) {
      if (e instanceof ObdCommandError && (e.code === "UNKNOWN_COMMAND" || e.code === "NO_DATA")) return null;
      throw e;
    }
  }

  /**
   * PID 01 from every ECU that answers: the check-engine light is on if any ECU says so, code counts add up,
   * and the monitors come from the ECU that reports the most (the engine).
   */
  async readReadiness(): Promise<Readiness | null> {
    try {
      const all = mode01Payloads(await this.elm.send("0101"), 0x01)
        .filter((p) => p.length >= 4)
        .map(decodeReadiness);
      if (!all.length) return null;
      const main = all.reduce((a, b) => (b.monitors.length > a.monitors.length ? b : a));
      return {
        ...main,
        milOn: all.some((r) => r.milOn),
        dtcCount: all.reduce((n, r) => n + r.dtcCount, 0),
      };
    } catch (e) {
      if (isNoData(e)) return null;
      throw e;
    }
  }

  async readMonitorStatus(): Promise<{ milOn: boolean; dtcCount: number } | null> {
    const r = await this.readReadiness();
    return r ? { milOn: r.milOn, dtcCount: r.dtcCount } : null;
  }

  /** Stored (Mode 03) and pending (Mode 07) codes. Engine and emissions only; ABS/SRS need a manufacturer tool. */
  async readDtcs(): Promise<DtcReading> {
    return { stored: await this.readCodeList("03", 0x43), pending: await this.readCodeList("07", 0x47) };
  }

  /** Permanent codes (Mode 0A): can't be cleared with a scan tool, only by the car after it sees the fault gone. */
  readPermanentDtcs(): Promise<string[]> {
    return this.readCodeList("0A", 0x4a);
  }

  private async readCodeList(cmd: string, mode: 0x43 | 0x47 | 0x4a): Promise<string[]> {
    try {
      return parseDtcReply(await this.elm.send(cmd, { timeoutMs: 5000 }), mode, this.canFramed);
    } catch (e) {
      // Some ECUs answer NO DATA instead of an empty list; older cars don't know Mode 0A.
      if (isNoData(e) || (e instanceof ObdCommandError && e.code === "UNKNOWN_COMMAND")) return [];
      throw e;
    }
  }

  /** Freeze frame 0: the sensor values saved when a code was set. Null when no frame is stored. */
  async readFreezeFrame(): Promise<FreezeFrame | null> {
    let dtc: string | null;
    try {
      dtc = parseFreezeFrameDtc(await this.elm.send("020200"));
    } catch (e) {
      if (isNoData(e)) return null;
      throw e;
    }
    if (!dtc) return null;
    const values: FreezeFrame["values"] = {};
    for (const key of FREEZE_FRAME_KEYS) {
      if (!this.isSupported(key)) continue;
      const def = PIDS[key];
      try {
        const payload = freezeFramePayload(await this.elm.send(`02${hex(def.pid)}00`), def.pid);
        if (payload && payload.length >= def.bytes) values[key] = decodePid(def, payload);
      } catch (e) {
        if (!isNoData(e)) throw e;
      }
    }
    return { dtc, values };
  }

  /**
   * Mode 06 self-test results. Only the CAN format is supported, which covers cars sold in India since 2013
   * (BS-IV) and most from earlier. Returns null when the car doesn't offer Mode 06.
   */
  async readMode06(): Promise<Mode06Test[] | null> {
    if (!this.canFramed) return null;
    const mids = new Set<number>();
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0, 0xe0]) {
      if (base !== 0x00 && !mids.has(base)) break;
      try {
        parseMode06Supported(await this.elm.send(`06${hex(base)}`, { timeoutMs: 4000 }), base).forEach((m) => mids.add(m));
      } catch (e) {
        if (isNoData(e) || (e instanceof ObdCommandError && e.code === "UNKNOWN_COMMAND")) break;
        throw e;
      }
    }
    if (!mids.size) return null;
    const tests: Mode06Test[] = [];
    for (const mid of [...mids].sort((a, b) => a - b)) {
      if (mid % 0x20 === 0) continue;
      try {
        tests.push(...parseMode06(await this.elm.send(`06${hex(mid)}`, { timeoutMs: 4000 })));
      } catch (e) {
        if (!isNoData(e)) throw e;
      }
    }
    return tests;
  }

  /** VIN, calibration IDs and ECU name (Mode 09), plus fuel type (PID 51). Fields the car doesn't offer are empty. */
  async readVehicleInfo(): Promise<VehicleInfo> {
    const ask = async <T>(cmd: string, parse: (l: string[]) => T, fallback: T): Promise<T> => {
      try {
        return parse(await this.elm.send(cmd, { timeoutMs: 5000 }));
      } catch (e) {
        // A car that ignores the request (or an adapter that times out on it) just has no value.
        if (e instanceof ObdCommandError) return fallback;
        throw e;
      }
    };
    const vin = await ask("0902", parseVin, null);
    const calibrationIds = await ask("0904", parseCalibrationIds, []);
    const ecuName = await ask("090A", parseEcuName, null);
    let fuelType: string | null = null;
    if (this.supported.has(0x51)) {
      const payload = await ask("0151", (l) => mode01Payload(l, 0x51), null);
      fuelType = payload ? (FUEL_TYPES[payload[0]] ?? null) : null;
    }
    return { vin, calibrationIds, ecuName, fuelType };
  }

  /** Mode 04: clears codes and resets readiness monitors. Driver Assist only, after the user confirms. */
  async clearDtcs(): Promise<void> {
    await this.elm.send("04", { timeoutMs: 5000 });
  }

  close(): Promise<void> {
    return this.elm.close();
  }
}
