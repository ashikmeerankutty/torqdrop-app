import { useSyncExternalStore } from "react";

import { addDemand } from "./live";
import { metricDef, type MetricKey, readMetric } from "./metrics";

const MAX_ROWS = 200_000;

interface Recording {
  keys: MetricKey[];
  startedAt: number;
  everyMs: number;
  rows: (number | null)[][];
}

let rec: Recording | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let release: (() => void) | null = null;
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Log chosen readings at a fixed rate until stopped. Keeps running when the screen is left. */
export function startRecording(keys: MetricKey[], everyMs = 250) {
  stopRecording();
  rec = { keys, startedAt: Date.now(), everyMs, rows: [] };
  release = addDemand([...new Set(keys.flatMap((k) => metricDef(k).sources))], everyMs);
  timer = setInterval(() => {
    if (!rec) return;
    const v = keys.map((k) => {
      const x = readMetric(k);
      return typeof x === "number" ? x : null;
    });
    rec.rows.push([Date.now(), ...v]);
    if (rec.rows.length >= MAX_ROWS) stopRecording();
    if (rec.rows.length % 8 === 0) emit();
  }, everyMs);
  emit();
}

/** Stop and return what was logged, as CSV header and rows. */
export function stopRecording(): { header: string[]; rows: unknown[][] } | null {
  if (timer) clearInterval(timer);
  timer = null;
  release?.();
  release = null;
  const r = rec;
  rec = null;
  emit();
  if (!r) return null;
  const header = ["time", "seconds", ...r.keys.map((k) => `${metricDef(k).name} (${metricDef(k).unit})`)];
  const rows = r.rows.map(([t, ...vals]) => [new Date(t as number).toISOString(), (((t as number) - r.startedAt) / 1000).toFixed(2), ...vals]);
  return { header, rows };
}

export function useRecording(): { active: boolean; rows: number; startedAt: number | null } {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
  return { active: !!rec, rows: rec?.rows.length ?? 0, startedAt: rec?.startedAt ?? null };
}
