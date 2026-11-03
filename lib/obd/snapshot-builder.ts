import type { LiveSnapshot } from "../schemas/snapshot";

interface Sample {
  t: number;
  value: number;
}

interface PidMeta {
  unit: string;
  samples: Sample[];
}

/**
 * Rolls raw readings into the normalised snapshot sent to the AI.
 * Keeps only the last `windowSeconds` of samples per PID.
 */
export class SnapshotBuilder {
  private pids = new Map<string, PidMeta>();
  private mil = { on: false, dtcCount: 0 };
  private dtcs = { stored: [] as string[], pending: [] as string[] };
  private unsupported = new Set<string>();

  constructor(
    private opts: { windowSeconds?: number; simulated: boolean },
    private now: () => number = Date.now,
  ) {}

  private get windowMs() {
    return (this.opts.windowSeconds ?? 30) * 1000;
  }

  addReading(key: string, unit: string, value: number) {
    const meta = this.pids.get(key) ?? { unit, samples: [] };
    meta.samples.push({ t: this.now(), value });
    this.pids.set(key, meta);
    this.trim(meta);
  }

  markUnsupported(key: string) {
    this.unsupported.add(key);
  }

  setMil(on: boolean, dtcCount: number) {
    this.mil = { on, dtcCount };
  }

  setDtcs(stored: string[], pending: string[]) {
    this.dtcs = { stored, pending };
  }

  private trim(meta: PidMeta) {
    const cutoff = this.now() - this.windowMs;
    while (meta.samples.length && meta.samples[0].t < cutoff) meta.samples.shift();
  }

  build(trigger: string): LiveSnapshot {
    const pids: LiveSnapshot["pids"] = {};
    for (const [key, meta] of this.pids) {
      this.trim(meta);
      const vals = meta.samples.map((s) => s.value);
      if (!vals.length) continue;
      const sum = vals.reduce((a, b) => a + b, 0);
      pids[key] = {
        unit: meta.unit,
        last: vals[vals.length - 1],
        min: Math.min(...vals),
        avg: Math.round((sum / vals.length) * 100) / 100,
        max: Math.max(...vals),
        samples: vals.length,
      };
    }
    return {
      capturedAt: new Date(this.now()).toISOString(),
      windowSeconds: this.opts.windowSeconds ?? 30,
      simulated: this.opts.simulated,
      mil: this.mil,
      dtcs: this.dtcs,
      pids,
      unsupportedPids: [...this.unsupported],
      trigger,
    };
  }
}
