import { getDb, notify } from "@/lib/db";
import type { PerfResult, PerfType } from "@/lib/obd/performance";

export interface RunRow {
  id: number;
  vehicleId: string | null;
  type: PerfType;
  timeS: number;
  at: number;
  simulated: number;
  detail: string | null;
}

export async function saveRun(vehicleId: string | null, type: PerfType, r: PerfResult, simulated: boolean) {
  const db = await getDb();
  const detail = { distanceM: r.distanceM, endSpeed: r.endSpeed, peakHp: r.peakHp, samples: r.samples.map((s) => [s.t, s.v]) };
  await db.runAsync(
    "INSERT INTO runs (vehicleId, type, timeS, at, simulated, detail) VALUES (?, ?, ?, ?, ?, ?)",
    vehicleId,
    type,
    r.timeS,
    Date.now(),
    simulated ? 1 : 0,
    JSON.stringify(detail),
  );
  notify("runs");
}

/** Fastest runs of a type for a car (simulated runs listed separately from real ones). */
export async function bestRuns(vehicleId: string | null, type: PerfType, limit = 5): Promise<RunRow[]> {
  const db = await getDb();
  return db.getAllAsync<RunRow>(
    "SELECT * FROM runs WHERE (vehicleId IS ? OR vehicleId = ?) AND type = ? ORDER BY simulated, timeS LIMIT ?",
    vehicleId,
    vehicleId,
    type,
    limit,
  );
}

export async function deleteRun(id: number) {
  const db = await getDb();
  await db.runAsync("DELETE FROM runs WHERE id = ?", id);
  notify("runs");
}
