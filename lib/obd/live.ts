import { useEffect, useSyncExternalStore } from "react";

import type { PidKey } from "./pid-decoder";

/** Everything the poller can read: standard PIDs plus the adapter's own battery reading (ATRV). */
export type LiveKey = PidKey | "batteryVoltage";

export interface Sample {
  t: number;
  v: number;
}

/** History kept per value, for sparklines, graphs and the performance timers. */
const HISTORY_MS = 10 * 60_000;
const HISTORY_MAX = 12_000;

type Listener = () => void;
type SampleListener = (key: LiveKey, value: number | null, t: number) => void;

/**
 * Latest reading per value, with short history. Kept outside React state so a 10 Hz gauge only
 * re-renders the components that read that value, not the whole screen.
 */
class LiveStore {
  private values = new Map<LiveKey, number | null>();
  private stamps = new Map<LiveKey, number>();
  private history = new Map<LiveKey, Sample[]>();
  private keyListeners = new Map<LiveKey, Set<Listener>>();
  private sampleListeners = new Set<SampleListener>();

  get(key: LiveKey): number | null | undefined {
    return this.values.get(key);
  }

  /** When the value was last read, or 0. */
  stamp(key: LiveKey): number {
    return this.stamps.get(key) ?? 0;
  }

  getHistory(key: LiveKey, sinceMs = HISTORY_MS): Sample[] {
    const h = this.history.get(key) ?? [];
    const cutoff = Date.now() - sinceMs;
    let i = 0;
    while (i < h.length && h[i].t < cutoff) i++;
    return i ? h.slice(i) : h;
  }

  set(key: LiveKey, value: number | null, t = Date.now()) {
    this.values.set(key, value);
    this.stamps.set(key, t);
    if (value !== null) {
      const h = this.history.get(key) ?? [];
      h.push({ t, v: value });
      if (h.length > HISTORY_MAX || t - h[0].t > HISTORY_MS * 1.2) {
        const cutoff = t - HISTORY_MS;
        let i = 0;
        while (i < h.length - 1 && (h[i].t < cutoff || h.length - i > HISTORY_MAX)) i++;
        h.splice(0, i);
      }
      this.history.set(key, h);
    }
    this.keyListeners.get(key)?.forEach((l) => l());
    this.sampleListeners.forEach((l) => l(key, value, t));
  }

  subscribe(key: LiveKey, l: Listener): () => void {
    let set = this.keyListeners.get(key);
    if (!set) this.keyListeners.set(key, (set = new Set()));
    set.add(l);
    return () => set.delete(l);
  }

  /** Every new reading, for recorders (trips, performance runs, alerts). */
  onSample(l: SampleListener): () => void {
    this.sampleListeners.add(l);
    return () => this.sampleListeners.delete(l);
  }

  snapshot(): Partial<Record<LiveKey, number | null>> {
    return Object.fromEntries(this.values) as Partial<Record<LiveKey, number | null>>;
  }

  reset() {
    this.values.clear();
    this.stamps.clear();
    this.history.clear();
    for (const [, set] of this.keyListeners) set.forEach((l) => l());
  }
}

export const live = new LiveStore();

/** Latest value: undefined before the first read, null when the car doesn't support it. */
export function useLive(key: LiveKey): number | null | undefined {
  return useSyncExternalStore(
    (l) => live.subscribe(key, l),
    () => live.get(key),
  );
}

// ---- Demand: which values to poll, how often ----

interface Demand {
  keys: LiveKey[];
  intervalMs: number;
}

let nextDemandId = 1;
const demands = new Map<number, Demand>();
const demandListeners = new Set<Listener>();

/** Ask the poller to read `keys` at least every `intervalMs`. 0 means as fast as the adapter allows. Returns a release function. */
export function addDemand(keys: LiveKey[], intervalMs: number): () => void {
  const id = nextDemandId++;
  demands.set(id, { keys, intervalMs });
  demandListeners.forEach((l) => l());
  return () => {
    demands.delete(id);
    demandListeners.forEach((l) => l());
  };
}

/** Effective polling interval per value: the fastest any current consumer wants. */
export function demandedIntervals(): Map<LiveKey, number> {
  const out = new Map<LiveKey, number>();
  for (const d of demands.values()) {
    for (const k of d.keys) out.set(k, Math.min(out.get(k) ?? Infinity, d.intervalMs));
  }
  return out;
}

export function onDemandChange(l: Listener): () => void {
  demandListeners.add(l);
  return () => demandListeners.delete(l);
}

/** Poll `keys` every `intervalMs` while the calling component is mounted (and `enabled`). */
export function usePidDemand(keys: readonly LiveKey[], intervalMs: number, enabled = true) {
  const sig = keys.join(",");
  useEffect(() => {
    if (!enabled || !sig) return;
    return addDemand(sig.split(",") as LiveKey[], intervalMs);
  }, [sig, intervalMs, enabled]);
}
