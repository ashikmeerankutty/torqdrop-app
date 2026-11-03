import { describe, expect, it } from "vitest";

import { gradeBattery } from "../lib/obd/battery-test";
import { computeHealth, tamperFlags } from "../lib/obd/health";
import { PerfRun } from "../lib/obd/performance";
import { decodeReadiness } from "../lib/obd/pid-decoder";

describe("health score", () => {
  const clean = { milOn: false, stored: [], pending: [], permanent: [], readiness: null, mode06: [], ltft: 2, stft: 1, runningVoltage: 14.1, coolant: 90 };

  it("scores a clean car 100", () => {
    expect(computeHealth(clean)).toMatchObject({ score: 100, factors: [] });
  });

  it("takes points for codes, the MIL and far-off fuel trims", () => {
    const r = computeHealth({ ...clean, milOn: true, stored: ["P0171"], ltft: 18, stft: 6 });
    expect(r.score).toBe(100 - 25 - 12 - 15);
    expect(r.factors.map((f) => f.label)).toContain("Fuel trim far off (+24 %)");
  });
});

describe("tamper flags", () => {
  it("flags a recent clear and unfinished monitors", () => {
    const readiness = decodeReadiness([0x00, 0x07, 0b1110_0101, 0b0010_0101]);
    const flags = tamperFlags({ readiness, distanceSinceClear: 42, warmUpsSinceClear: 3, timeSinceClear: 90, distanceWithMil: 0 });
    expect(flags.map((f) => f.id)).toEqual(["recent_clear", "monitors_incomplete"]);
  });

  it("notices driving with the light on when it's now off", () => {
    expect(tamperFlags({ readiness: null, distanceSinceClear: 5000, warmUpsSinceClear: 200, timeSinceClear: 9000, distanceWithMil: 120 }).map((f) => f.id)).toEqual([
      "mil_history",
    ]);
  });
});

describe("battery grading", () => {
  it("grades each step", () => {
    const g = gradeBattery({ resting: 12.65, crankMin: 9.4, idle: 14.2, loaded: 12.9 });
    expect(g.map((l) => l.grade)).toEqual(["good", "defect", "good", "attention"]);
  });
});

describe("performance timer", () => {
  const feedAll = (run: PerfRun, pts: [number, number][]) => pts.map(([t, v]) => run.feed({ t, v })).at(-1)!;

  it("times 0–100 with interpolated start and finish", () => {
    const run = new PerfRun("zero100");
    const pts: [number, number][] = [
      [0, 0],
      [1000, 0],
      [1100, 5], // crossed 0.5 km/h at 1010 ms
    ];
    for (let t = 1600, v = 15; v <= 95; t += 500, v += 10) pts.push([t, v]);
    pts.push([10_100, 105]); // 95 at 5600 ms → crossed 100 at 7850 ms
    const s = feedAll(run, pts);
    expect(s.phase).toBe("done");
    expect(s.result!.timeS).toBeCloseTo(6.84, 2);
  });

  it("aborts if speed drops mid-run", () => {
    const s = feedAll(new PerfRun("zero100"), [
      [0, 0],
      [500, 20],
      [1000, 40],
      [1500, 25],
    ]);
    expect(s.phase).toBe("aborted");
  });

  it("measures 100–0 braking distance", () => {
    const run = new PerfRun("brake100");
    const pts: [number, number][] = [
      [0, 105],
      [500, 102],
      [1000, 98],
    ];
    // ~8 m/s² stop.
    for (let t = 1500, v = 84; v > 0; t += 500, v -= 14) pts.push([t, v]);
    pts.push([4500, 0]);
    const s = feedAll(run, pts);
    expect(s.phase).toBe("done");
    expect(s.result!.distanceM).toBeGreaterThan(30);
    expect(s.result!.distanceM).toBeLessThan(60);
  });
});
