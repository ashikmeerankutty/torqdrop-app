import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/** Per-device settings for the car features. Kept in the local key-value store. */
export interface CarSettings {
  /** Price of a litre of fuel, for trip cost. */
  fuelPrice: number;
  currency: string;
  economyUnit: "kmpl" | "l100km";
  /** The car the app is talking to or showing, picked automatically by VIN when it can be read. */
  activeVehicleId: string | null;
  alerts: {
    enabled: boolean;
    vibrate: boolean;
    coolantC: number;
    lowVoltage: number;
    /** 0 = off. */
    overspeedKmh: number;
    /** 0 = 90 % of the car's redline. */
    shiftRpm: number;
  };
  /** Mirror the car-mode screen so it reads correctly reflected in the windscreen. */
  hudMirror: boolean;
  /** Record trips automatically while an adapter is connected. */
  autoTrips: boolean;
  /** Use the phone's GPS during trips for the route map. */
  tripGps: boolean;
}

const KEY = "car.settings";

const DEFAULTS: CarSettings = {
  fuelPrice: 105,
  currency: "₹",
  economyUnit: "kmpl",
  activeVehicleId: null,
  alerts: { enabled: true, vibrate: true, coolantC: 108, lowVoltage: 12.2, overspeedKmh: 0, shiftRpm: 0 },
  hudMirror: false,
  autoTrips: true,
  tripGps: true,
};

let settings: CarSettings | null = null;
const listeners = new Set<() => void>();

function load(): CarSettings {
  try {
    const raw = Storage.getItemSync(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CarSettings>;
      return { ...DEFAULTS, ...parsed, alerts: { ...DEFAULTS.alerts, ...parsed.alerts } };
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULTS;
}

export function getCarSettings(): CarSettings {
  return (settings ??= load());
}

export function updateCarSettings(patch: Partial<Omit<CarSettings, "alerts">> & { alerts?: Partial<CarSettings["alerts"]> }) {
  const cur = getCarSettings();
  settings = { ...cur, ...patch, alerts: { ...cur.alerts, ...patch.alerts } };
  try {
    Storage.setItemSync(KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("settings not saved", e);
  }
  listeners.forEach((l) => l());
}

export function useCarSettings(): CarSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCarSettings,
  );
}

/** Small JSON values (dashboard layouts, learned gear ratios) in the same store. */
export function readJson<T>(key: string): T | null {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch (e) {
    console.warn("not saved", key, e);
  }
}
