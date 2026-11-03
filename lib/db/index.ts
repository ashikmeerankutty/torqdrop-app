import * as SQLite from "expo-sqlite";

/**
 * Local database for car data that belongs to this phone: vehicles, trips, performance runs,
 * maintenance and reminders. Opened on first use, never at import time (release bundling
 * evaluates modules in Node, where native modules aren't available).
 */
let db: SQLite.SQLiteDatabase | null = null;
let ready: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE vehicles (
    id TEXT PRIMARY KEY NOT NULL,
    vin TEXT UNIQUE,
    name TEXT NOT NULL,
    make TEXT,
    model TEXT,
    year INTEGER,
    fuel TEXT NOT NULL DEFAULT 'petrol',
    displacementL REAL,
    weightKg REAL,
    redlineRpm INTEGER,
    tankL REAL,
    odometerKm REAL,
    odometerAt INTEGER,
    ecuInfo TEXT,
    gears TEXT,
    createdAt INTEGER NOT NULL
  );
  CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleId TEXT,
    startedAt INTEGER NOT NULL,
    endedAt INTEGER NOT NULL,
    distanceKm REAL NOT NULL,
    durationS REAL NOT NULL,
    movingS REAL NOT NULL,
    idleS REAL NOT NULL,
    maxSpeed REAL NOT NULL,
    fuelL REAL,
    fuelEstimated INTEGER NOT NULL DEFAULT 1,
    harshAccel INTEGER NOT NULL DEFAULT 0,
    harshBrake INTEGER NOT NULL DEFAULT 0,
    highRev INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    simulated INTEGER NOT NULL DEFAULT 0,
    stats TEXT
  );
  CREATE INDEX trips_vehicle ON trips (vehicleId, startedAt);
  CREATE TABLE trip_samples (
    tripId INTEGER NOT NULL,
    t INTEGER NOT NULL,
    lat REAL,
    lon REAL,
    speed REAL,
    rpm REAL,
    throttle REAL,
    fuelLph REAL,
    coolant REAL
  );
  CREATE INDEX trip_samples_trip ON trip_samples (tripId, t);
  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleId TEXT,
    type TEXT NOT NULL,
    timeS REAL NOT NULL,
    at INTEGER NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    detail TEXT
  );
  CREATE INDEX runs_vehicle ON runs (vehicleId, type, timeS);
  CREATE TABLE maintenance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleId TEXT NOT NULL,
    at INTEGER NOT NULL,
    odometerKm REAL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    cost REAL,
    notes TEXT
  );
  CREATE INDEX maintenance_vehicle ON maintenance (vehicleId, at);
  CREATE TABLE reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicleId TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    everyKm REAL,
    everyMonths REAL,
    lastKm REAL,
    lastAt INTEGER
  );
  `,
  // Simulated sessions no longer get a garage entry. Remove the old "Simulated car", unless a real
  // car was linked to it (it has real trips, runs or service entries): then it becomes "My car".
  `
  CREATE TEMP TABLE sim_cars AS SELECT id FROM vehicles WHERE vin = 'MA3EWDE1SS0123456';
  UPDATE trips SET vehicleId = NULL WHERE simulated = 1 AND vehicleId IN (SELECT id FROM sim_cars);
  UPDATE runs SET vehicleId = NULL WHERE simulated = 1 AND vehicleId IN (SELECT id FROM sim_cars);
  DELETE FROM sim_cars WHERE id IN (SELECT vehicleId FROM trips WHERE vehicleId IS NOT NULL)
    OR id IN (SELECT vehicleId FROM runs WHERE vehicleId IS NOT NULL)
    OR id IN (SELECT vehicleId FROM maintenance);
  UPDATE vehicles SET vin = NULL, make = NULL, model = NULL, year = NULL, ecuInfo = NULL, gears = NULL,
    name = CASE WHEN name = 'Simulated car' THEN 'My car' ELSE name END
    WHERE vin = 'MA3EWDE1SS0123456' AND id NOT IN (SELECT id FROM sim_cars);
  DELETE FROM reminders WHERE vehicleId IN (SELECT id FROM sim_cars);
  DELETE FROM vehicles WHERE id IN (SELECT id FROM sim_cars);
  DROP TABLE sim_cars;
  `,
  // Engine sound checks: the AI result is kept on the phone; the clip itself is deleted after analysis.
  `
  CREATE TABLE engine_checks (
    id TEXT PRIMARY KEY,
    vehicleId TEXT,
    at INTEGER NOT NULL,
    durationS REAL NOT NULL,
    place TEXT NOT NULL,
    concerns TEXT NOT NULL,
    result TEXT NOT NULL,
    safety TEXT NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    trace TEXT
  );
  CREATE INDEX engine_checks_vehicle ON engine_checks (vehicleId, at);
  `,
];

async function migrate(d: SQLite.SQLiteDatabase) {
  await d.execAsync("PRAGMA journal_mode = WAL;");
  const row = await d.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await d.withTransactionAsync(async () => {
      await d.execAsync(MIGRATIONS[version]);
      await d.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return Promise.resolve(db);
  ready ??= (async () => {
    const d = await SQLite.openDatabaseAsync("torqdrop.db");
    await migrate(d);
    db = d;
    return d;
  })();
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

// ---- Tiny change feed so screens refresh after writes ----

type Table = "vehicles" | "trips" | "runs" | "maintenance" | "reminders" | "engine_checks";
const listeners = new Map<Table, Set<() => void>>();

export function notify(table: Table) {
  listeners.get(table)?.forEach((l) => l());
}

export function onTableChange(table: Table, l: () => void): () => void {
  let set = listeners.get(table);
  if (!set) listeners.set(table, (set = new Set()));
  set.add(l);
  return () => set.delete(l);
}
