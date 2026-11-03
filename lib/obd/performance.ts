export type PerfType = "zero100" | "zero60" | "sixty100" | "brake100" | "quarter";

export const PERF_TESTS: Record<PerfType, { label: string; short: string; how: string }> = {
  zero100: { label: "0–100 km/h", short: "0–100", how: "Stop completely. The timer starts when the car moves and stops at 100 km/h." },
  zero60: { label: "0–60 km/h", short: "0–60", how: "Stop completely. The timer starts when the car moves and stops at 60 km/h." },
  sixty100: { label: "60–100 km/h in gear", short: "60–100", how: "Drive below 55 km/h, then accelerate. Timed from 60 to 100 km/h." },
  brake100: { label: "100–0 km/h braking", short: "Brake", how: "Reach 100 km/h, then brake firmly to a stop. Shows stopping time and distance." },
  quarter: { label: "Quarter mile (402 m)", short: "¼ mile", how: "Stop completely. Timed over 402 m from the moment the car moves." },
};

export type PerfPhase = "waiting" | "armed" | "running" | "done" | "aborted";

export interface PerfSample {
  t: number;
  /** km/h */
  v: number;
}

export interface PerfResult {
  timeS: number;
  /** Metres covered during the timed part. */
  distanceM: number;
  /** Speed at the finish (quarter mile trap speed). */
  endSpeed: number;
  /** Peak wheel power estimate from acceleration, if the car's weight is known. */
  peakHp: number | null;
  samples: PerfSample[];
}

export interface PerfState {
  phase: PerfPhase;
  message: string;
  elapsedS: number;
  result?: PerfResult;
}

const QUARTER_M = 402.336;
const TIMEOUT_MS = 60_000;

/** Time at which speed crossed `thr` between two samples (linear). */
function crossing(a: PerfSample, b: PerfSample, thr: number): number {
  if (b.v === a.v) return b.t;
  return a.t + ((thr - a.v) / (b.v - a.v)) * (b.t - a.t);
}

/**
 * Timer for one performance test, fed with OBD speed readings. Crossing times are interpolated
 * between readings, so the result is finer than the adapter's update rate.
 */
export class PerfRun {
  private phase: PerfPhase = "waiting";
  private prev: PerfSample | null = null;
  private startT = 0;
  private distanceM = 0;
  private maxV = 0;
  private samples: PerfSample[] = [];
  private result?: PerfResult;
  private abortReason = "";
  private peakW = 0;

  constructor(
    readonly type: PerfType,
    /** Car plus driver, for the power estimate. */
    private massKg: number | null = null,
  ) {}

  feed(s: PerfSample): PerfState {
    const p = this.prev;
    this.prev = s;
    switch (this.phase) {
      case "waiting":
      case "armed":
        // Start is checked against the previous state: the sample that starts a run no longer satisfies "armed".
        if (this.phase === "armed" && p && this.started(p, s)) this.begin(p, s);
        else this.phase = this.armed(s) ? "armed" : "waiting";
        break;
      case "running":
        if (p) this.run(p, s);
        break;
    }
    return this.state(s.t);
  }

  private armed(s: PerfSample): boolean {
    if (this.type === "sixty100") return s.v < 55 || (this.phase === "armed" && s.v < 60);
    if (this.type === "brake100") return s.v >= 100;
    return s.v === 0;
  }

  private threshold(): number {
    return this.type === "sixty100" ? 60 : this.type === "brake100" ? 100 : 0.5;
  }

  private started(p: PerfSample, s: PerfSample): boolean {
    const thr = this.threshold();
    return this.type === "brake100" ? p.v >= thr && s.v < thr : p.v < thr && s.v >= thr;
  }

  private begin(p: PerfSample, s: PerfSample) {
    this.phase = "running";
    this.startT = crossing(p, s, this.threshold());
    this.distanceM = ((s.v / 3.6) * (s.t - this.startT)) / 2000;
    this.maxV = s.v;
    this.samples = [{ t: this.startT, v: this.threshold() }, s];
  }

  private run(p: PerfSample, s: PerfSample) {
    const dt = (s.t - p.t) / 1000;
    this.distanceM += (((p.v + s.v) / 2 / 3.6) * dt);
    this.samples.push(s);
    this.maxV = Math.max(this.maxV, s.v);
    if (this.massKg && dt > 0) {
      const a = (s.v - p.v) / 3.6 / dt;
      this.peakW = Math.max(this.peakW, this.massKg * a * ((s.v + p.v) / 2 / 3.6));
    }
    const accelTest = this.type !== "brake100";
    if (s.t - this.startT > TIMEOUT_MS) return this.abort("Took longer than a minute.");
    if (accelTest && s.v < this.maxV - 8) return this.abort("Speed dropped during the run.");
    if (!accelTest && s.v > p.v + 5) return this.abort("The car sped up during the stop.");

    let endT: number | null = null;
    if (this.type === "zero100" || this.type === "sixty100") {
      if (s.v >= 100) endT = crossing(p, s, 100);
    } else if (this.type === "zero60") {
      if (s.v >= 60) endT = crossing(p, s, 60);
    } else if (this.type === "brake100") {
      if (s.v === 0) endT = crossing(p, s, 0);
    } else if (this.distanceM >= QUARTER_M) {
      // Back out the overshoot past 402 m at the current speed.
      const over = this.distanceM - QUARTER_M;
      endT = s.t - (s.v > 0 ? (over / (s.v / 3.6)) * 1000 : 0);
      this.distanceM = QUARTER_M;
    }
    if (endT != null) {
      this.phase = "done";
      this.result = {
        timeS: Math.round(((endT - this.startT) / 1000) * 100) / 100,
        distanceM: Math.round(this.distanceM * 10) / 10,
        endSpeed: Math.round(s.v),
        peakHp: this.massKg && this.peakW > 0 ? Math.round((this.peakW / 1000) * 1.341) : null,
        samples: this.samples,
      };
    }
  }

  private abort(reason: string) {
    this.phase = "aborted";
    this.abortReason = reason;
  }

  private state(now: number): PerfState {
    const elapsedS = this.phase === "running" ? (now - this.startT) / 1000 : (this.result?.timeS ?? 0);
    const messages: Record<PerfPhase, string> = {
      waiting:
        this.type === "brake100"
          ? "Reach 100 km/h"
          : this.type === "sixty100"
            ? "Slow to below 55 km/h"
            : "Come to a complete stop",
      armed: this.type === "brake100" ? "Ready: brake firmly" : this.type === "sixty100" ? "Ready: accelerate" : "Ready: go when safe",
      running: "Timing…",
      done: "Done",
      aborted: this.abortReason,
    };
    return { phase: this.phase, message: messages[this.phase], elapsedS, result: this.result };
  }
}
