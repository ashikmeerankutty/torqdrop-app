import { getDb, notify } from "@/lib/db";
import type { TripStats } from "@/lib/obd/trip-stats";

export interface Trip {
  id: number;
  vehicleId: string | null;
  startedAt: number;
  endedAt: number;
  distanceKm: number;
  durationS: number;
  movingS: number;
  idleS: number;
  maxSpeed: number;
  fuelL: number | null;
  fuelEstimated: number;
  harshAccel: number;
  harshBrake: number;
  highRev: number;
  score: number | null;
  simulated: number;
  stats: TripStats | null;
}

export interface TripSample {
  t: number;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  rpm: number | null;
  throttle: number | null;
  fuelLph: number | null;
  coolant: number | null;
}

type Row = Omit<Trip, "stats"> & { stats: string | null };
const fromRow = (r: Row): Trip => ({ ...r, stats: r.stats ? JSON.parse(r.stats) : null });

/** Finished trips (a trip still recording has score NULL). */
export async function listTrips(vehicleId: string | null, limit = 50): Promise<Trip[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    "SELECT * FROM trips WHERE (vehicleId IS ? OR vehicleId = ?) AND score IS NOT NULL ORDER BY startedAt DESC LIMIT ?",
    vehicleId,
    vehicleId,
    limit,
  );
  return rows.map(fromRow);
}

export async function getTrip(id: number): Promise<Trip | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>("SELECT * FROM trips WHERE id = ?", id);
  return r ? fromRow(r) : null;
}

export async function getTripSamples(id: number): Promise<TripSample[]> {
  const db = await getDb();
  return db.getAllAsync<TripSample>("SELECT t, lat, lon, speed, rpm, throttle, fuelLph, coolant FROM trip_samples WHERE tripId = ? ORDER BY t", id);
}

export async function deleteTrip(id: number) {
  const db = await getDb();
  await db.runAsync("DELETE FROM trip_samples WHERE tripId = ?", id);
  await db.runAsync("DELETE FROM trips WHERE id = ?", id);
  notify("trips");
}

export interface TripTotals {
  trips: number;
  distanceKm: number;
  durationS: number;
  fuelL: number;
  avgScore: number | null;
}

export async function tripTotals(vehicleId: string | null, since: number): Promise<TripTotals> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ trips: number; distanceKm: number | null; durationS: number | null; fuelL: number | null; avgScore: number | null }>(
    `SELECT COUNT(*) AS trips, SUM(distanceKm) AS distanceKm, SUM(durationS) AS durationS, SUM(fuelL) AS fuelL, AVG(score) AS avgScore
     FROM trips WHERE (vehicleId IS ? OR vehicleId = ?) AND startedAt >= ? AND score IS NOT NULL AND simulated = 0`,
    vehicleId,
    vehicleId,
    since,
  );
  return {
    trips: r?.trips ?? 0,
    distanceKm: r?.distanceKm ?? 0,
    durationS: r?.durationS ?? 0,
    fuelL: r?.fuelL ?? 0,
    avgScore: r?.avgScore != null ? Math.round(r.avgScore) : null,
  };
}

/** Per-trip health stats, oldest first, for trend detection. Real trips only. */
export async function statsHistory(vehicleId: string, limit = 40): Promise<TripStats[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ stats: string | null }>(
    "SELECT stats FROM trips WHERE vehicleId = ? AND stats IS NOT NULL AND simulated = 0 ORDER BY startedAt DESC LIMIT ?",
    vehicleId,
    limit,
  );
  return rows.map((r) => JSON.parse(r.stats!) as TripStats).reverse();
}
