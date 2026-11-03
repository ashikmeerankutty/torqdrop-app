import * as Crypto from "expo-crypto";

import { getCarSettings, updateCarSettings, useCarSettings } from "@/lib/car-settings";
import { getDb, notify } from "@/lib/db";
import { useDbQuery } from "@/lib/db/use-query";
import { decodeVin } from "@/lib/obd/modes";

export type FuelKind = "petrol" | "diesel" | "cng" | "lpg" | "hybrid" | "electric";

export const FUEL_LABEL: Record<FuelKind, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  cng: "CNG",
  lpg: "LPG",
  hybrid: "Hybrid",
  electric: "Electric",
};

export interface Vehicle {
  id: string;
  vin: string | null;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  fuel: FuelKind;
  displacementL: number | null;
  weightKg: number | null;
  redlineRpm: number | null;
  tankL: number | null;
  /** Last known odometer and when it was known. Trips add to it; PID A6 replaces it when the car reports one. */
  odometerKm: number | null;
  odometerAt: number | null;
  ecuInfo: EcuInfo | null;
  /** Learned km/h per 1000 rpm for each gear, lowest gear first. */
  gears: number[] | null;
  createdAt: number;
}

type Row = Omit<Vehicle, "ecuInfo" | "gears"> & { ecuInfo: string | null; gears: string | null };

const fromRow = (r: Row): Vehicle => ({
  ...r,
  ecuInfo: r.ecuInfo ? JSON.parse(r.ecuInfo) : null,
  gears: r.gears ? JSON.parse(r.gears) : null,
});

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await getDb();
  return (await db.getAllAsync<Row>("SELECT * FROM vehicles ORDER BY createdAt")).map(fromRow);
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>("SELECT * FROM vehicles WHERE id = ?", id);
  return r ? fromRow(r) : null;
}

export async function createVehicle(v: Partial<Omit<Vehicle, "id" | "createdAt">> & { name: string }): Promise<Vehicle> {
  const db = await getDb();
  const vehicle: Vehicle = {
    id: Crypto.randomUUID(),
    vin: null,
    make: null,
    model: null,
    year: null,
    fuel: "petrol",
    displacementL: null,
    weightKg: null,
    redlineRpm: null,
    tankL: null,
    odometerKm: null,
    odometerAt: null,
    ecuInfo: null,
    gears: null,
    createdAt: Date.now(),
    ...v,
  };
  await db.runAsync(
    `INSERT INTO vehicles (id, vin, name, make, model, year, fuel, displacementL, weightKg, redlineRpm, tankL, odometerKm, odometerAt, ecuInfo, gears, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    vehicle.id,
    vehicle.vin,
    vehicle.name,
    vehicle.make,
    vehicle.model,
    vehicle.year,
    vehicle.fuel,
    vehicle.displacementL,
    vehicle.weightKg,
    vehicle.redlineRpm,
    vehicle.tankL,
    vehicle.odometerKm,
    vehicle.odometerAt,
    vehicle.ecuInfo ? JSON.stringify(vehicle.ecuInfo) : null,
    vehicle.gears ? JSON.stringify(vehicle.gears) : null,
    vehicle.createdAt,
  );
  await addDefaultReminders(vehicle.id, vehicle.fuel);
  notify("vehicles");
  return vehicle;
}

const COLUMNS = ["vin", "name", "make", "model", "year", "fuel", "displacementL", "weightKg", "redlineRpm", "tankL", "odometerKm", "odometerAt", "ecuInfo", "gears"] as const;

export async function updateVehicle(id: string, patch: Partial<Omit<Vehicle, "id" | "createdAt">>) {
  const db = await getDb();
  const keys = COLUMNS.filter((k) => k in patch);
  if (!keys.length) return;
  const values = keys.map((k) => {
    const v = patch[k];
    return k === "ecuInfo" || k === "gears" ? (v ? JSON.stringify(v) : null) : (v as string | number | null);
  });
  await db.runAsync(`UPDATE vehicles SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...values, id);
  notify("vehicles");
}

export async function deleteVehicle(id: string) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM trip_samples WHERE tripId IN (SELECT id FROM trips WHERE vehicleId = ?)", id);
    for (const table of ["trips", "runs", "maintenance", "reminders", "engine_checks"]) await db.runAsync(`DELETE FROM ${table} WHERE vehicleId = ?`, id);
    await db.runAsync("DELETE FROM vehicles WHERE id = ?", id);
  });
  if (getCarSettings().activeVehicleId === id) updateCarSettings({ activeVehicleId: null });
  for (const t of ["vehicles", "trips", "runs", "maintenance", "reminders", "engine_checks"] as const) notify(t);
}

/** What the adapter tells us about a car, used to recognise it next time when it has no VIN. */
export interface EcuInfo {
  calibrationIds: string[];
  ecuName: string | null;
  /** Supported PID list as hex, a weaker fingerprint for cars that report no calibration IDs either. */
  pids?: string;
}

/** How the connected car was matched to the garage. */
export type VehicleMatch = "vin" | "ecu" | "assumed" | "new" | "confirmed";

const hasFingerprint = (e: EcuInfo | null): e is EcuInfo => !!e && (e.calibrationIds.length > 0 || !!e.pids);

export function sameEcu(a: EcuInfo | null, b: EcuInfo): boolean {
  if (!hasFingerprint(a)) return false;
  if (a.calibrationIds.length && b.calibrationIds.length) return a.calibrationIds.some((id) => b.calibrationIds.includes(id));
  return !!a.pids && a.pids === b.pids;
}

export interface AdapterCarInfo {
  vin: string | null;
  fuelType: string | null;
  calibrationIds: string[];
  ecuName: string | null;
  pids: string;
}

/** A new garage entry for the car on the adapter, named from its VIN when it has one. */
export async function createVehicleFromAdapter(info: AdapterCarInfo): Promise<Vehicle> {
  const all = await listVehicles();
  const decoded = info.vin ? decodeVin(info.vin) : { make: null, year: null };
  const fuel: FuelKind = /diesel/i.test(info.fuelType ?? "")
    ? "diesel"
    : /cng/i.test(info.fuelType ?? "")
      ? "cng"
      : /hybrid/i.test(info.fuelType ?? "")
        ? "hybrid"
        : "petrol";
  const v = await createVehicle({
    name: decoded.make ? `${decoded.make}${decoded.year ? ` ${decoded.year}` : ""}` : all.length ? `Car ${all.length + 1}` : "My car",
    vin: info.vin,
    make: decoded.make,
    year: decoded.year,
    fuel,
    ecuInfo: { calibrationIds: info.calibrationIds, ecuName: info.ecuName, pids: info.pids },
  });
  updateCarSettings({ activeVehicleId: v.id });
  return v;
}

/**
 * The garage entry for a real car on the adapter (simulated sessions never touch the garage).
 * By VIN when the car reports one; otherwise by its engine software and supported PIDs; otherwise
 * the selected car if it has never been connected; otherwise a new car.
 */
export async function vehicleForConnection(info: AdapterCarInfo): Promise<{ vehicle: Vehicle; match: VehicleMatch }> {
  const ecuInfo: EcuInfo = { calibrationIds: info.calibrationIds, ecuName: info.ecuName, pids: info.pids };
  const all = await listVehicles();
  const use = async (v: Vehicle, match: VehicleMatch) => {
    const patch = { ecuInfo, ...(info.vin && !v.vin ? { vin: info.vin } : {}) };
    await updateVehicle(v.id, patch);
    updateCarSettings({ activeVehicleId: v.id });
    return { vehicle: { ...v, ...patch }, match };
  };
  if (info.vin) {
    const byVin = all.find((v) => v.vin === info.vin);
    if (byVin) return use(byVin, "vin");
  }
  const byEcu = all.filter((v) => (!info.vin || !v.vin) && sameEcu(v.ecuInfo, ecuInfo));
  if (byEcu.length === 1) return use(byEcu[0], "ecu");
  const active = all.find((v) => v.id === getCarSettings().activeVehicleId) ?? (all.length === 1 ? all[0] : null);
  if (active && !hasFingerprint(active.ecuInfo) && (!info.vin || !active.vin)) return use(active, "assumed");
  return { vehicle: await createVehicleFromAdapter(info), match: "new" };
}

/** Fold one car into another: its trips, runs and service log move over, and it is removed. */
export async function mergeVehicle(fromId: string, intoId: string) {
  const db = await getDb();
  const [from, into] = [await getVehicle(fromId), await getVehicle(intoId)];
  if (!from || !into) return;
  await db.withTransactionAsync(async () => {
    for (const table of ["trips", "runs", "maintenance", "engine_checks"]) await db.runAsync(`UPDATE ${table} SET vehicleId = ? WHERE vehicleId = ?`, intoId, fromId);
    await db.runAsync("DELETE FROM reminders WHERE vehicleId = ?", fromId);
    await db.runAsync("DELETE FROM vehicles WHERE id = ?", fromId);
  });
  await updateVehicle(intoId, { ecuInfo: from.ecuInfo ?? into.ecuInfo, vin: into.vin ?? from.vin });
  updateCarSettings({ activeVehicleId: intoId });
  for (const t of ["vehicles", "trips", "runs", "maintenance", "reminders"] as const) notify(t);
}

/** Move trips recorded since `since` from one car to another (used when the adapter's car was matched to the wrong one). */
export async function moveTrips(fromId: string, toId: string, since: number) {
  const db = await getDb();
  await db.runAsync("UPDATE trips SET vehicleId = ? WHERE vehicleId = ? AND startedAt >= ?", toId, fromId, since);
  notify("trips");
}

/** The car shown on the Garage tab and used for gauges and trip costs. Falls back to the first car. */
export function useActiveVehicle(): { vehicle: Vehicle | null; vehicles: Vehicle[]; loading: boolean } {
  const { activeVehicleId } = useCarSettings();
  const { data, loading } = useDbQuery(listVehicles, [], ["vehicles"]);
  const vehicles = data ?? [];
  return { vehicle: vehicles.find((v) => v.id === activeVehicleId) ?? vehicles[0] ?? null, vehicles, loading };
}

/** Odometer now: the last reading plus trip distance logged since. */
export async function currentOdometer(v: Vehicle): Promise<number | null> {
  if (v.odometerKm == null) return null;
  const db = await getDb();
  const r = await db.getFirstAsync<{ km: number | null }>(
    "SELECT SUM(distanceKm) AS km FROM trips WHERE vehicleId = ? AND startedAt >= ? AND simulated = 0",
    v.id,
    v.odometerAt ?? 0,
  );
  return v.odometerKm + (r?.km ?? 0);
}

// ---- Reminders and maintenance ----

export type ServiceKind = "oil" | "air_filter" | "fuel_filter" | "spark_plugs" | "coolant" | "brake_fluid" | "tyres" | "battery" | "service" | "other";

export const SERVICE_LABEL: Record<ServiceKind, string> = {
  oil: "Engine oil and filter",
  air_filter: "Air filter",
  fuel_filter: "Fuel filter",
  spark_plugs: "Spark plugs",
  coolant: "Coolant",
  brake_fluid: "Brake fluid",
  tyres: "Tyre rotation",
  battery: "Battery check",
  service: "General service",
  other: "Other",
};

export interface Reminder {
  id: number;
  vehicleId: string;
  kind: ServiceKind;
  title: string;
  everyKm: number | null;
  everyMonths: number | null;
  lastKm: number | null;
  lastAt: number | null;
}

export interface MaintenanceEntry {
  id: number;
  vehicleId: string;
  at: number;
  odometerKm: number | null;
  kind: ServiceKind;
  title: string;
  cost: number | null;
  notes: string | null;
}

/** Typical Indian-market intervals; the owner can edit them. */
async function addDefaultReminders(vehicleId: string, fuel: FuelKind) {
  const db = await getDb();
  const defaults: [ServiceKind, number | null, number | null][] = [
    ["oil", 10_000, 12],
    ["air_filter", 20_000, 24],
    ["coolant", 40_000, 36],
    ["brake_fluid", null, 24],
    ["tyres", 10_000, null],
    ["battery", null, 12],
  ];
  if (fuel === "petrol" || fuel === "cng" || fuel === "lpg") defaults.push(["spark_plugs", 30_000, null]);
  if (fuel === "diesel") defaults.push(["fuel_filter", 20_000, null]);
  for (const [kind, km, months] of defaults) {
    await db.runAsync(
      "INSERT INTO reminders (vehicleId, kind, title, everyKm, everyMonths) VALUES (?, ?, ?, ?, ?)",
      vehicleId,
      kind,
      SERVICE_LABEL[kind],
      km,
      months,
    );
  }
  notify("reminders");
}

export async function listReminders(vehicleId: string): Promise<Reminder[]> {
  const db = await getDb();
  return db.getAllAsync<Reminder>("SELECT * FROM reminders WHERE vehicleId = ? ORDER BY id", vehicleId);
}

export async function saveReminder(r: Omit<Reminder, "id"> & { id?: number }) {
  const db = await getDb();
  if (r.id) {
    await db.runAsync(
      "UPDATE reminders SET kind = ?, title = ?, everyKm = ?, everyMonths = ?, lastKm = ?, lastAt = ? WHERE id = ?",
      r.kind,
      r.title,
      r.everyKm,
      r.everyMonths,
      r.lastKm,
      r.lastAt,
      r.id,
    );
  } else {
    await db.runAsync(
      "INSERT INTO reminders (vehicleId, kind, title, everyKm, everyMonths, lastKm, lastAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      r.vehicleId,
      r.kind,
      r.title,
      r.everyKm,
      r.everyMonths,
      r.lastKm,
      r.lastAt,
    );
  }
  notify("reminders");
}

export async function deleteReminder(id: number) {
  const db = await getDb();
  await db.runAsync("DELETE FROM reminders WHERE id = ?", id);
  notify("reminders");
}

export interface ReminderStatus {
  reminder: Reminder;
  /** Negative when overdue. Null when that limit isn't set or the last service isn't known. */
  kmLeft: number | null;
  daysLeft: number | null;
  state: "unknown" | "ok" | "soon" | "due";
}

const MONTH_MS = 30.44 * 86_400_000;

export function reminderStatus(r: Reminder, odometerKm: number | null, now = Date.now()): ReminderStatus {
  const kmLeft = r.everyKm != null && r.lastKm != null && odometerKm != null ? r.lastKm + r.everyKm - odometerKm : null;
  const daysLeft = r.everyMonths != null && r.lastAt != null ? Math.round((r.lastAt + r.everyMonths * MONTH_MS - now) / 86_400_000) : null;
  if (kmLeft == null && daysLeft == null) return { reminder: r, kmLeft, daysLeft, state: "unknown" };
  const due = (kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0);
  const soon = (kmLeft != null && kmLeft <= 1000) || (daysLeft != null && daysLeft <= 30);
  return { reminder: r, kmLeft, daysLeft, state: due ? "due" : soon ? "soon" : "ok" };
}

export async function listMaintenance(vehicleId: string): Promise<MaintenanceEntry[]> {
  const db = await getDb();
  return db.getAllAsync<MaintenanceEntry>("SELECT * FROM maintenance WHERE vehicleId = ? ORDER BY at DESC", vehicleId);
}

/** Log work done. A matching reminder restarts its interval from this entry. */
export async function addMaintenance(e: Omit<MaintenanceEntry, "id">) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO maintenance (vehicleId, at, odometerKm, kind, title, cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    e.vehicleId,
    e.at,
    e.odometerKm,
    e.kind,
    e.title,
    e.cost,
    e.notes,
  );
  if (e.kind !== "other") {
    await db.runAsync(
      "UPDATE reminders SET lastAt = ?, lastKm = COALESCE(?, lastKm) WHERE vehicleId = ? AND (kind = ? OR (? = 'service' AND kind = 'oil'))",
      e.at,
      e.odometerKm,
      e.vehicleId,
      e.kind,
      e.kind,
    );
    notify("reminders");
  }
  if (e.odometerKm != null) {
    const v = await getVehicle(e.vehicleId);
    if (v && (v.odometerAt == null || e.at >= v.odometerAt)) await updateVehicle(e.vehicleId, { odometerKm: e.odometerKm, odometerAt: e.at });
  }
  notify("maintenance");
}

export async function deleteMaintenance(id: number) {
  const db = await getDb();
  await db.runAsync("DELETE FROM maintenance WHERE id = ?", id);
  notify("maintenance");
}

/** "in 1,200 km · in 40 days" or "300 km overdue". */
export function formatDue(kmLeft: number | null, daysLeft: number | null): string {
  const parts: string[] = [];
  if (kmLeft != null) parts.push(kmLeft <= 0 ? `${Math.round(-kmLeft).toLocaleString()} km overdue` : `in ${Math.round(kmLeft).toLocaleString()} km`);
  if (daysLeft != null) parts.push(daysLeft <= 0 ? `${-daysLeft} days overdue` : `in ${daysLeft} days`);
  return parts.join(' · ');
}
