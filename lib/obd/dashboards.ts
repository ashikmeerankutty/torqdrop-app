import { useSyncExternalStore } from "react";

import { readJson, writeJson } from "@/lib/car-settings";

import type { MetricKey } from "./metrics";

export type GaugeStyle = "dial" | "bar" | "number" | "spark";

export const STYLE_LABEL: Record<GaugeStyle, string> = { dial: "Dial", bar: "Bar", number: "Number", spark: "Chart" };

export interface Tile {
  id: string;
  metric: MetricKey;
  style: GaugeStyle;
  /** Full width instead of half. */
  wide: boolean;
}

export interface Board {
  id: string;
  name: string;
  tiles: Tile[];
}

export interface Dashboards {
  active: string;
  boards: Board[];
}

let seq = 0;
export const tileId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;
const t = (metric: MetricKey, style: GaugeStyle, wide = false): Tile => ({ id: tileId(), metric, style, wide });

/** Starting layouts. The owner can edit, reorder and add more. */
export function presetBoards(): Board[] {
  return [
    {
      id: "drive",
      name: "Drive",
      tiles: [
        t("speed", "dial"),
        t("rpm", "dial"),
        t("gear", "number"),
        t("coolantTemp", "number"),
        t("economy", "spark"),
        t("fuelLevel", "bar"),
        t("moduleVoltage", "number"),
        t("throttle", "bar"),
      ],
    },
    {
      id: "engine",
      name: "Engine",
      tiles: [
        t("engineLoad", "bar"),
        t("timingAdvance", "number"),
        t("shortFuelTrim1", "spark"),
        t("longFuelTrim1", "number"),
        t("map", "number"),
        t("intakeTemp", "number"),
        t("oilTemp", "number"),
        t("maf", "spark"),
      ],
    },
    {
      id: "performance",
      name: "Performance",
      tiles: [t("boost", "dial"), t("power", "dial"), t("accel", "spark", true), t("torque", "number"), t("rpm", "bar")],
    },
    {
      id: "economy",
      name: "Economy",
      tiles: [t("economy", "dial", true), t("fuelFlow", "spark"), t("speed", "number"), t("fuelLevel", "bar"), t("throttle", "bar")],
    },
  ];
}

const keyFor = (vehicleId: string | null | undefined) => `dash.v1.${vehicleId ?? "default"}`;

const cache = new Map<string, Dashboards>();
const listeners = new Set<() => void>();

export function getDashboards(vehicleId: string | null | undefined): Dashboards {
  const key = keyFor(vehicleId);
  let d = cache.get(key);
  if (!d) {
    // A new car starts from the default layout (if edited), else the presets.
    d = readJson<Dashboards>(key) ?? (vehicleId ? readJson<Dashboards>(keyFor(null)) : null) ?? { active: "drive", boards: presetBoards() };
    cache.set(key, d);
  }
  return d;
}

export function saveDashboards(vehicleId: string | null | undefined, d: Dashboards) {
  const key = keyFor(vehicleId);
  cache.set(key, d);
  writeJson(key, d);
  listeners.forEach((l) => l());
}

export function useDashboards(vehicleId: string | null | undefined): Dashboards {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getDashboards(vehicleId),
  );
}

export function activeBoard(d: Dashboards): Board {
  return d.boards.find((b) => b.id === d.active) ?? d.boards[0];
}

export function updateBoard(vehicleId: string | null | undefined, board: Board) {
  const d = getDashboards(vehicleId);
  saveDashboards(vehicleId, { ...d, boards: d.boards.map((b) => (b.id === board.id ? board : b)) });
}
