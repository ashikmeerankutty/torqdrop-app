import { useSyncExternalStore } from "react";

import type { FuelKind, Vehicle } from "@/lib/garage/vehicles";

import { live, type LiveKey } from "./live";
import { isPidKey, type PidCategory, PIDS } from "./pid-decoder";

/**
 * Everything a gauge can show: raw readings plus values worked out from them.
 * Derived values are estimates and are labelled that way in the UI.
 */
export type DerivedKey = "boost" | "fuelFlow" | "economy" | "power" | "torque" | "gear" | "accel";
export type MetricKey = LiveKey | DerivedKey;

export interface MetricDef {
  name: string;
  short: string;
  unit: string;
  min: number;
  max: number;
  decimals: number;
  category: PidCategory | "derived";
  /** Readings needed to show it. Derived values poll all of these. */
  sources: LiveKey[];
  /** Derived values are calculated, not reported by the car. */
  estimate?: boolean;
}

const DERIVED: Record<DerivedKey, MetricDef> = {
  boost: { name: "Boost / vacuum", short: "Boost", unit: "bar", min: -1, max: 2, decimals: 2, category: "derived", sources: ["map", "baroPressure"] },
  fuelFlow: {
    name: "Fuel flow",
    short: "Fuel flow",
    unit: "L/h",
    min: 0,
    max: 30,
    decimals: 1,
    category: "derived",
    sources: ["fuelRate", "maf", "map", "intakeTemp", "rpm"],
    estimate: true,
  },
  economy: {
    name: "Fuel economy (instant)",
    short: "Economy",
    unit: "km/L",
    min: 0,
    max: 40,
    decimals: 1,
    category: "derived",
    sources: ["speed", "fuelRate", "maf", "map", "intakeTemp", "rpm"],
    estimate: true,
  },
  power: {
    name: "Engine power",
    short: "Power",
    unit: "hp",
    min: 0,
    max: 250,
    decimals: 0,
    category: "derived",
    sources: ["rpm", "actualTorque", "referenceTorque", "fuelRate", "maf", "map", "intakeTemp"],
    estimate: true,
  },
  torque: {
    name: "Engine torque",
    short: "Torque",
    unit: "Nm",
    min: 0,
    max: 400,
    decimals: 0,
    category: "derived",
    sources: ["rpm", "actualTorque", "referenceTorque", "fuelRate", "maf", "map", "intakeTemp"],
    estimate: true,
  },
  gear: { name: "Gear (estimated)", short: "Gear", unit: "", min: 0, max: 6, decimals: 0, category: "derived", sources: ["speed", "rpm"], estimate: true },
  accel: { name: "Acceleration", short: "G-force", unit: "g", min: -1, max: 1, decimals: 2, category: "derived", sources: ["speed"], estimate: true },
};

const BATTERY: MetricDef = {
  name: "Battery voltage (at the OBD port)",
  short: "Battery",
  unit: "V",
  min: 8,
  max: 16,
  decimals: 1,
  category: "electrical",
  sources: ["batteryVoltage"],
};

export function metricDef(key: MetricKey): MetricDef {
  if (key === "batteryVoltage") return BATTERY;
  if (isPidKey(key)) {
    const p = PIDS[key];
    return { name: p.name, short: p.short, unit: p.unit, min: p.min, max: p.max, decimals: p.decimals, category: p.category, sources: [key] };
  }
  return DERIVED[key];
}

export const DERIVED_KEYS = Object.keys(DERIVED) as DerivedKey[];

export function isDerived(key: MetricKey): key is DerivedKey {
  return key in DERIVED;
}

// ---- The car the numbers are for ----

let vehicle: Vehicle | null = null;
const vehicleListeners = new Set<() => void>();

/** Profile used by estimates (engine size, fuel, redline, gears). Set by the connection and the garage. */
export function setMetricsVehicle(v: Vehicle | null) {
  vehicle = v;
  gearLearner.seed(v?.gears ?? null);
  vehicleListeners.forEach((l) => l());
}

export function getMetricsVehicle(): Vehicle | null {
  return vehicle;
}

export function useMetricsVehicle(): Vehicle | null {
  return useSyncExternalStore(
    (l) => {
      vehicleListeners.add(l);
      return () => vehicleListeners.delete(l);
    },
    () => vehicle,
  );
}

/** Redline for gauges and the shift light: the owner's value, or a guess from the fuel type. */
export function redlineRpm(v: Vehicle | null = vehicle): number {
  return v?.redlineRpm ?? (v?.fuel === "diesel" ? 4500 : 6500);
}

// ---- Fuel ----

const FUEL: Record<FuelKind, { afr: number; densityGL: number; bsfc: number }> = {
  petrol: { afr: 14.7, densityGL: 745, bsfc: 290 },
  diesel: { afr: 14.5, densityGL: 832, bsfc: 230 },
  // Gas fuels are reported as petrol-equivalent litres; the UI says so.
  cng: { afr: 14.7, densityGL: 745, bsfc: 290 },
  lpg: { afr: 14.7, densityGL: 745, bsfc: 290 },
  hybrid: { afr: 14.7, densityGL: 745, bsfc: 270 },
  electric: { afr: 14.7, densityGL: 745, bsfc: 290 },
};

type Get = (k: LiveKey) => number | null | undefined;
const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Air mass flow in g/s: the MAF sensor, or speed-density from MAP, intake temperature, rpm and engine size. */
export function airFlow(get: Get, v: Vehicle | null): number | null {
  const maf = get("maf");
  if (num(maf)) return maf;
  const [map, iat, rpm] = [get("map"), get("intakeTemp"), get("rpm")];
  if (!num(map) || !num(iat) || !num(rpm)) return null;
  const displacement = v?.displacementL ?? 1.5;
  const ve = 0.85;
  // n = PV/RT per second, times the molar mass of air.
  const litresPerS = (displacement * rpm) / 120;
  return ((map * 1000 * (litresPerS / 1000) * ve) / (8.314 * (iat + 273.15))) * 28.97;
}

/** Fuel use in L/h: the car's own fuel rate, or worked out from airflow. Diesel from airflow is a rough guess (lean burn). */
export function fuelFlowLph(get: Get, v: Vehicle | null): number | null {
  const rate = get("fuelRate");
  if (num(rate)) return rate;
  const air = airFlow(get, v);
  if (air == null) return null;
  const f = FUEL[v?.fuel ?? "petrol"];
  return ((air / f.afr) * 3600) / f.densityGL;
}

function powerKw(get: Get, v: Vehicle | null): number | null {
  const [rpm, pct, ref] = [get("rpm"), get("actualTorque"), get("referenceTorque")];
  if (num(rpm) && num(pct) && num(ref)) return Math.max(0, ((pct / 100) * ref * rpm * 2 * Math.PI) / 60 / 1000);
  const lph = fuelFlowLph(get, v);
  if (lph == null) return null;
  const f = FUEL[v?.fuel ?? "petrol"];
  // Brake-specific fuel consumption: grams of fuel per kWh at the crank. Idle fuel makes no useful power.
  const idle = (v?.displacementL ?? 1.5) * 0.45;
  return Math.max(0, (((lph - idle) * f.densityGL) / f.bsfc));
}

const KW_TO_HP = 1.341;

export function computeDerived(key: DerivedKey, get: Get, v: Vehicle | null): number | null | undefined {
  switch (key) {
    case "boost": {
      const map = get("map");
      if (map === undefined) return undefined;
      if (!num(map)) return null;
      const baro = get("baroPressure");
      return (map - (num(baro) ? baro : 101.3)) / 100;
    }
    case "fuelFlow":
      return fuelFlowLph(get, v);
    case "economy": {
      const speed = get("speed");
      const lph = fuelFlowLph(get, v);
      if (!num(speed) || lph == null) return speed === undefined ? undefined : null;
      if (speed < 3 || lph <= 0.05) return null;
      return Math.min(99, speed / lph);
    }
    case "power": {
      const kw = powerKw(get, v);
      return kw == null ? null : kw * KW_TO_HP;
    }
    case "torque": {
      const [rpm, pct, ref] = [get("rpm"), get("actualTorque"), get("referenceTorque")];
      if (num(pct) && num(ref)) return Math.max(0, (pct / 100) * ref);
      const kw = powerKw(get, v);
      if (kw == null || !num(rpm) || rpm < 800) return null;
      return (kw * 1000) / ((rpm * 2 * Math.PI) / 60);
    }
    case "gear": {
      const [speed, rpm] = [get("speed"), get("rpm")];
      if (!num(speed) || !num(rpm)) return null;
      return gearLearner.gearFor(speed, rpm);
    }
    case "accel":
      return accelG();
  }
}

/** Longitudinal acceleration in g from the last second of speed readings. */
function accelG(): number | null {
  const h = live.getHistory("speed", 2000);
  if (h.length < 2) return null;
  const last = h[h.length - 1];
  let i = h.length - 2;
  while (i > 0 && last.t - h[i].t < 600) i--;
  const first = h[i];
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.2) return null;
  return (last.v - first.v) / 3.6 / dt / 9.81;
}

/** Current value of any metric. */
export function readMetric(key: MetricKey): number | null | undefined {
  if (!isDerived(key)) return live.get(key);
  return computeDerived(key, (k) => live.get(k), vehicle);
}

/** Subscribe to a metric; re-renders when any of its sources changes. */
export function useMetric(key: MetricKey): number | null | undefined {
  return useSyncExternalStore(
    (l) => {
      const offs = metricDef(key).sources.map((s) => live.subscribe(s, l));
      vehicleListeners.add(l);
      return () => {
        offs.forEach((o) => o());
        vehicleListeners.delete(l);
      };
    },
    () => {
      const v = readMetric(key);
      // Round so tiny float noise doesn't re-render.
      return typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
    },
  );
}

// ---- Gear learning ----

interface Cluster {
  c: number;
  n: number;
}

/**
 * Learns the car's gear ratios (km/h per 1000 rpm) by clustering steady driving samples.
 * Until a few gears are seen, gear estimates are null.
 */
class GearLearner {
  private clusters: Cluster[] = [];

  seed(gears: number[] | null) {
    this.clusters = (gears ?? []).map((c) => ({ c, n: 60 }));
  }

  feed(speed: number, rpm: number, throttle: number | null | undefined) {
    // Skip idling, clutch-in coasting and wheelspin-prone launches.
    if (speed < 8 || rpm < 1000 || (num(throttle) && throttle < 2)) return;
    const r = speed / (rpm / 1000);
    let best: Cluster | null = null;
    for (const cl of this.clusters) if (Math.abs(cl.c - r) / cl.c < 0.05 && (!best || Math.abs(cl.c - r) < Math.abs(best.c - r))) best = cl;
    if (best) {
      best.n++;
      best.c += (r - best.c) / Math.min(best.n, 200);
    } else {
      this.clusters.push({ c: r, n: 1 });
    }
    if (this.clusters.length > 40) {
      // Drop noise (gear changes, clutch slip) that never repeated.
      this.clusters.sort((a, b) => b.n - a.n);
      this.clusters = this.clusters.slice(0, 20);
    }
  }

  /** Confident gear ratios, lowest gear first. */
  gears(): number[] {
    return this.clusters
      .filter((c) => c.n >= 30)
      .map((c) => c.c)
      .sort((a, b) => a - b)
      .slice(0, 8);
  }

  gearFor(speed: number, rpm: number): number | null {
    if (speed < 3 || rpm < 600) return 0;
    const r = speed / (rpm / 1000);
    const gears = this.gears();
    if (gears.length < 2) return null;
    let best = -1;
    let err = Infinity;
    gears.forEach((g, i) => {
      const e = Math.abs(g - r) / g;
      if (e < err) [best, err] = [i, e];
    });
    return err < 0.08 ? best + 1 : null;
  }
}

export const gearLearner = new GearLearner();
