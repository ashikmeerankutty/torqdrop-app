import { getStorage, putFile, ref } from "@react-native-firebase/storage";
import { getAuth } from "@react-native-firebase/auth";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";

import type { SafetyBanner } from "@/lib/diagnostics/safety-rules";
import { getDb, notify } from "@/lib/db";
import { analyzeEngineClip } from "@/lib/firebase/ai";
import { currentOdometer } from "@/lib/garage/vehicles";
import { getObdState } from "@/lib/obd/connection";
import { addDemand, live, type LiveKey } from "@/lib/obd/live";
import { getMetricsVehicle } from "@/lib/obd/metrics";
import type { ClipPlace, EngineClipContext, EngineConcern, EngineSoundResult, ObdTracePoint } from "@/lib/schemas/engine-sound";

const TRACE_KEYS = ["rpm", "engineLoad", "throttle", "coolantTemp", "shortFuelTrim1", "longFuelTrim1", "map", "maf"] as const satisfies readonly LiveKey[];

/**
 * Samples live OBD data once a second while a clip records, so the AI can line up what it hears with
 * engine speed and load. Asks the adapter for these readings twice a second meanwhile.
 */
export function startObdTrace(): { stop: () => ObdTracePoint[] } {
  const state = getObdState();
  if (state.status !== "connected") return { stop: () => [] };
  const release = addDemand([...TRACE_KEYS], 500);
  const started = Date.now();
  const trace: ObdTracePoint[] = [];
  const sample = () => {
    const p: ObdTracePoint = { t: Math.round((Date.now() - started) / 100) / 10 };
    for (const k of TRACE_KEYS) {
      const v = live.get(k);
      if (typeof v === "number" && Number.isFinite(v)) p[k] = Math.round(v * 10) / 10;
    }
    trace.push(p);
  };
  sample();
  const id = setInterval(sample, 1000);
  return {
    stop: () => {
      clearInterval(id);
      release();
      return trace.slice(0, 60);
    },
  };
}

/** What the owner chose before recording. */
export interface ClipSetup {
  place: ClipPlace;
  engineWarm: boolean | null;
  concerns: EngineConcern[];
  description: string;
}

/** Builds the context sent with the clip: the car, the owner's concerns, and the OBD trace. */
export async function clipContext(setup: ClipSetup, durationS: number, trace: ObdTracePoint[]): Promise<EngineClipContext> {
  const v = getMetricsVehicle();
  const real = v && v.id !== "simulated" ? v : null;
  const obd = getObdState();
  return {
    durationS: Math.round(durationS * 10) / 10,
    place: setup.place,
    engineWarm: setup.engineWarm,
    concerns: setup.concerns,
    description: setup.description.trim() || undefined,
    vehicle: v
      ? {
          make: v.make,
          model: v.model,
          year: v.year,
          fuel: v.fuel,
          displacementL: v.displacementL,
          odometerKm: real ? await currentOdometer(real).catch(() => null) : null,
        }
      : undefined,
    obd:
      obd.status === "connected" && trace.length
        ? {
            simulated: obd.simulated,
            milOn: obd.mil?.milOn ?? false,
            stored: obd.dtcs?.stored ?? [],
            pending: obd.dtcs?.pending ?? [],
            trace,
          }
        : undefined,
  };
}

export type CheckStage = { step: "uploading"; progress: number } | { step: "listening" };

export interface EngineCheck {
  id: string;
  vehicleId: string | null;
  at: number;
  durationS: number;
  place: ClipPlace;
  concerns: EngineConcern[];
  result: EngineSoundResult;
  safety: SafetyBanner[];
  simulated: boolean;
  /** OBD readings during the clip, for the timeline. Empty without an adapter. */
  trace: ObdTracePoint[];
}

export type CheckOutcome = { status: "ok"; check: EngineCheck } | { status: "ai_unavailable"; safety: SafetyBanner[] };

/**
 * Uploads the clip, asks the server to analyse it, and saves the result on the phone. The server
 * deletes the clip after analysis; the local recording is deleted here once it's uploaded.
 */
export async function runEngineCheck(uri: string, context: EngineClipContext, onStage: (s: CheckStage) => void): Promise<CheckOutcome> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error("Sign in to use the engine sound check.");
  const id = Crypto.randomUUID();
  onStage({ step: "uploading", progress: 0 });
  const task = putFile(ref(getStorage(), `engine-clips/${uid}/${id}.mp4`), uri, { contentType: "video/mp4" });
  task.on("state_changed", (snap) => {
    if (snap.totalBytes > 0) onStage({ step: "uploading", progress: snap.bytesTransferred / snap.totalBytes });
  });
  await task;
  onStage({ step: "listening" });
  const r = await analyzeEngineClip(id, context);
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or in a cache the system clears anyway.
  }
  if (r.status !== "ok") return { status: "ai_unavailable", safety: r.safety };

  const vehicle = getMetricsVehicle();
  const check: EngineCheck = {
    id,
    vehicleId: vehicle && vehicle.id !== "simulated" ? vehicle.id : null,
    at: Date.now(),
    durationS: context.durationS,
    place: context.place,
    concerns: context.concerns,
    result: r.result,
    safety: r.safety,
    simulated: r.simulated,
    trace: context.obd?.trace ?? [],
  };
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO engine_checks (id, vehicleId, at, durationS, place, concerns, result, safety, simulated, trace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    check.id,
    check.vehicleId,
    check.at,
    check.durationS,
    check.place,
    JSON.stringify(check.concerns),
    JSON.stringify(check.result),
    JSON.stringify(check.safety),
    check.simulated ? 1 : 0,
    JSON.stringify(check.trace),
  );
  notify("engine_checks");
  return { status: "ok", check };
}

type Row = Omit<EngineCheck, "concerns" | "result" | "safety" | "simulated" | "trace"> & {
  concerns: string;
  result: string;
  safety: string;
  simulated: number;
  trace: string | null;
};
const fromRow = (r: Row): EngineCheck => ({
  ...r,
  concerns: JSON.parse(r.concerns),
  result: JSON.parse(r.result),
  safety: JSON.parse(r.safety),
  simulated: r.simulated === 1,
  trace: r.trace ? JSON.parse(r.trace) : [],
});

export async function getEngineCheck(id: string): Promise<EngineCheck | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Row>("SELECT * FROM engine_checks WHERE id = ?", id);
  return r ? fromRow(r) : null;
}

/** Most recent first. A car's list also includes checks made without a car selected. */
export async function listEngineChecks(vehicleId: string | null, limit = 30): Promise<EngineCheck[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    "SELECT * FROM engine_checks WHERE vehicleId IS ? OR vehicleId = ? OR vehicleId IS NULL ORDER BY at DESC LIMIT ?",
    vehicleId,
    vehicleId,
    limit,
  );
  return rows.map(fromRow);
}

export async function deleteEngineCheck(id: string) {
  const db = await getDb();
  await db.runAsync("DELETE FROM engine_checks WHERE id = ?", id);
  notify("engine_checks");
}
