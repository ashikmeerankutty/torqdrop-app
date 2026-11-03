import { describe, expect, it } from "vitest";

import { evaluateAlerts } from "../lib/obd/alert-rules";
import { live } from "../lib/obd/live";
import { computeDerived, fuelFlowLph, gearLearner } from "../lib/obd/metrics";
import { MockTransport } from "../lib/obd/mock-transport";
import {
  decodeVin,
  parseCalibrationIds,
  parseFreezeFrameDtc,
  parseMode06,
  parseVin,
  replyMessages,
  vinCheckDigitValid,
} from "../lib/obd/modes";
import { decodeReadiness, PIDS } from "../lib/obd/pid-decoder";
import { ObdSession } from "../lib/obd/session";
import { createSimulatedCar } from "../lib/obd/simulated-car";
import { scoreTrip, trendFlags, type TripStats } from "../lib/obd/trip-stats";

describe("readiness monitors (PID 01)", () => {
  it("decodes a spark-ignition car with evap incomplete", () => {
    const r = decodeReadiness([0x81, 0x07, 0b1110_0101, 0b0000_0100]);
    expect(r.milOn).toBe(true);
    expect(r.dtcCount).toBe(1);
    expect(r.ignition).toBe("spark");
    const evap = r.monitors.find((m) => m.key === "evap");
    expect(evap?.complete).toBe(false);
    expect(r.monitors.find((m) => m.key === "catalyst")?.complete).toBe(true);
    // Heated catalyst (bit 1) isn't fitted, so it isn't listed.
    expect(r.monitors.some((m) => m.key === "heatedCatalyst")).toBe(false);
    expect(r.monitors.filter((m) => ["misfire", "fuelSystem", "components"].includes(m.key))).toHaveLength(3);
  });

  it("uses the diesel monitor table when bit B3 is set", () => {
    const r = decodeReadiness([0x00, 0x0f, 0b0100_0000, 0b0100_0000]);
    expect(r.ignition).toBe("compression");
    expect(r.monitors.find((m) => m.key === "pmFilter")).toMatchObject({ complete: false });
  });
});

describe("Mode 09 vehicle info", () => {
  it("reads a CAN multi-frame VIN", () => {
    const lines = ["014", "0: 49 02 01 4D 41 33", "1: 45 57 44 45 31 53 30", "2: 30 31 32 33 34 35 36"];
    expect(parseVin(lines)).toBe("MA3EWDE1S00123456");
  });

  it("reads a legacy (K-line) VIN sent four bytes per line", () => {
    const vin = "1HGCM82633A004352";
    const data = [0, 0, 0, ...[...vin].map((c) => c.charCodeAt(0))];
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(["49", "02", `0${i + 1}`, ...data.slice(i * 4, i * 4 + 4).map((b) => b.toString(16).padStart(2, "0").toUpperCase())].join(" "));
    }
    expect(parseVin(lines)).toBe(vin);
    expect(vinCheckDigitValid(vin)).toBe(true);
  });

  it("splits calibration IDs and decodes the maker", () => {
    const id = [..."CAL-A"].map((c) => c.charCodeAt(0).toString(16).toUpperCase());
    const padded = [...id, ...new Array(11).fill("00")];
    const lines = ["013", `0: 49 04 01 ${padded.slice(0, 3).join(" ")}`, `1: ${padded.slice(3, 10).join(" ")}`, `2: ${padded.slice(10, 16).join(" ")}`];
    expect(parseCalibrationIds(lines)).toEqual(["CAL-A"]);
    expect(decodeVin("MA3EWDE1SS0123456", new Date("2026-01-01"))).toEqual({ make: "Maruti Suzuki", year: 2025 });
  });
});

describe("Mode 06 and freeze frame", () => {
  it("parses test results with pass/fail from raw limits", () => {
    const tests = parseMode06(["013", "0: 46 A2 0B 24 00 15 00", "1: 00 FF FF A2 0C 24 00", "2: 26 00 00 00 19 00 00"]);
    expect(tests).toHaveLength(2);
    expect(tests[0]).toMatchObject({ monitor: "Misfire cylinder 1", value: 21, passed: true });
    expect(tests[1]).toMatchObject({ test: "Misfires, last or current drive", value: 38, max: 25, passed: false });
  });

  it("compares signed values as signed", () => {
    // Value -2 against limits -5..5 with a signed scaling ID.
    const [t] = parseMode06(["46 21 01 81 FF FE FF FB 00 05"]);
    expect(t).toMatchObject({ value: -2, min: -5, max: 5, passed: true });
  });

  it("keeps two ECUs' multi-frame replies apart", () => {
    const msgs = replyMessages(["00A", "0: 41 00 BE 1F", "1: A8 13", "00A", "0: 41 00 98 18", "1: 80 11"]);
    expect(msgs).toHaveLength(2);
  });

  it("reads the code that stored the freeze frame", () => {
    expect(parseFreezeFrameDtc(["42 02 00 01 71"])).toBe("P0171");
    expect(parseFreezeFrameDtc(["42 02 00 00 00"])).toBeNull();
  });
});

describe("ObdSession extended reads on the simulated car", () => {
  const open = (now = () => 0) => {
    const t = new MockTransport(createSimulatedCar(now));
    return ObdSession.open(t).then((s) => ({ s, t }));
  };

  it("finds PIDs on later bitmap pages", async () => {
    const { s } = await open();
    expect(s.isSupported("odometer")).toBe(true);
    expect(s.isSupported("fuelRate")).toBe(true);
  });

  it("asks for a single reply on CAN for live values", async () => {
    const { s, t } = await open();
    await s.readPid("rpm");
    expect(t.written.at(-1)).toBe("010C1");
  });

  it("reads readiness, freeze frame, permanent codes and self-tests", async () => {
    const { s } = await open();
    const r = await s.readReadiness();
    expect(r?.monitors.find((m) => m.key === "evap")?.complete).toBe(false);
    const ff = await s.readFreezeFrame();
    expect(ff?.dtc).toBe("P0171");
    expect(ff?.values.rpm).toBe(2450);
    expect(ff?.values.coolantTemp).toBe(88);
    expect(await s.readPermanentDtcs()).toEqual(["P0171"]);
    const tests = await s.readMode06();
    expect(tests?.some((x) => !x.passed && x.monitor === "Misfire cylinder 1")).toBe(true);
    expect(tests?.find((x) => x.mid === 0x01)).toMatchObject({ value: 72, unit: "ms", passed: true });
  });

  it("reads the VIN, ECU details and battery voltage", async () => {
    const { s } = await open();
    const info = await s.readVehicleInfo();
    expect(info).toMatchObject({ vin: "MA3EWDE1SS0123456", ecuName: "ECM-EngineControl", fuelType: "Petrol", calibrationIds: ["SIM-ECU-1.2.0"] });
    expect(await s.readAdapterVoltage()).toBe(14.1);
  });

  it("decodes the odometer", async () => {
    const { s } = await open();
    expect(await s.readPid("odometer")).toBe(48210);
  });
});

describe("derived metrics", () => {
  const vehicle = { fuel: "petrol", displacementL: 1.2 } as never;

  it("works out fuel flow from MAF, and prefers the car's own fuel rate", () => {
    const get = (vals: Record<string, number | null>) => (k: string) => vals[k];
    // 10 g/s air → 0.68 g/s petrol → about 3.3 L/h.
    expect(fuelFlowLph(get({ maf: 10 }), vehicle)).toBeCloseTo(3.29, 1);
    expect(fuelFlowLph(get({ maf: 10, fuelRate: 2 }), vehicle)).toBe(2);
    // No MAF: speed-density from MAP, intake temperature and rpm.
    expect(fuelFlowLph(get({ maf: null, map: 100, intakeTemp: 25, rpm: 3000 }), vehicle)).toBeGreaterThan(5);
  });

  it("computes boost against barometric pressure", () => {
    const vals: Record<string, number> = { map: 180, baroPressure: 100 };
    expect(computeDerived("boost", (k) => vals[k], null)).toBeCloseTo(0.8);
  });

  it("learns gears from steady driving", () => {
    gearLearner.seed(null);
    const ratios = [8, 14, 21, 27];
    for (let i = 0; i < 200; i++) {
      const r = ratios[i % 4];
      gearLearner.feed(r * 2.5, 2500, 30);
    }
    expect(gearLearner.gears().map(Math.round)).toEqual(ratios);
    expect(gearLearner.gearFor(21 * 2, 2000)).toBe(3);
    expect(gearLearner.gearFor(0, 800)).toBe(0);
  });

  it("measures acceleration from speed history", () => {
    live.reset();
    const t0 = Date.now() - 1000;
    live.set("speed", 0, t0);
    live.set("speed", 36, t0 + 1000);
    // 36 km/h in a second = 10 m/s² ≈ 1.02 g.
    expect(computeDerived("accel", (k) => live.get(k), null)).toBeCloseTo(1.02, 1);
  });

  it("keeps catalogue ranges sane", () => {
    for (const [key, def] of Object.entries(PIDS)) {
      expect(def.max, key).toBeGreaterThan(def.min);
    }
  });
});

describe("trips", () => {
  const base = { distanceKm: 20, durationS: 1800, movingS: 1500, idleS: 300, harshAccel: 0, harshBrake: 0, highRev: 0 };

  it("scores a smooth drive 100 and penalises harsh events per distance", () => {
    expect(scoreTrip(base)).toBe(100);
    expect(scoreTrip({ ...base, harshBrake: 2 })).toBe(95);
    // The same two hard stops in 3 km cost more.
    expect(scoreTrip({ ...base, distanceKm: 3, harshBrake: 2 })).toBeLessThan(80);
  });

  it("flags a falling charging voltage", () => {
    const s = (v: number): TripStats => ({ runningVoltage: v, minRunningVoltage: null, warmupS: null, ltft: null, stft: null, maxCoolant: null, idleRpm: null });
    const history = [14.2, 14.1, 14.2, 14.1, 14.2, 14.1, 13.0, 12.9, 12.9].map(s);
    expect(trendFlags(history).map((f) => f.key)).toEqual(["runningVoltage"]);
    expect(trendFlags(history.slice(0, 6))).toEqual([]);
  });
});

describe("drive alerts", () => {
  const limits = { coolantC: 108, lowVoltage: 12.2, overspeedKmh: 100, redline: 6000 };

  it("raises overheating, low charging and overspeed", () => {
    const ids = evaluateAlerts({ coolant: 116, voltage: 11.8, speed: 110, rpm: 2500, milOn: false, milWasOn: false }, limits).map((a) => a.id);
    expect(ids).toEqual(["coolant", "voltage", "overspeed"]);
  });

  it("ignores low voltage with the engine off, and only flags the MIL when it comes on", () => {
    expect(evaluateAlerts({ coolant: 40, voltage: 11.9, speed: 0, rpm: 0, milOn: true, milWasOn: true }, limits)).toEqual([]);
    expect(evaluateAlerts({ coolant: 40, voltage: 14, speed: 0, rpm: 800, milOn: true, milWasOn: false }, limits).map((a) => a.id)).toEqual(["mil"]);
  });
});
