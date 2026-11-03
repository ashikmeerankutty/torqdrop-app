import type { Mode06Test } from "./modes";
import type { Readiness } from "./pid-decoder";

export interface HealthInput {
  milOn: boolean;
  stored: string[];
  pending: string[];
  permanent: string[] | null;
  readiness: Readiness | null;
  mode06: Mode06Test[] | null;
  /** Warm-engine averages where known. */
  ltft: number | null | undefined;
  stft: number | null | undefined;
  /** Voltage with the engine running. */
  runningVoltage: number | null | undefined;
  coolant: number | null | undefined;
}

export interface HealthFactor {
  label: string;
  /** Points taken off the score. */
  points: number;
  tone: "good" | "attention" | "defect";
}

export interface HealthResult {
  score: number;
  verdict: string;
  factors: HealthFactor[];
}

/**
 * A rough 0–100 health score from what standard OBD can see. It never claims a car is fault-free:
 * mechanical wear, ABS/airbag and body issues are outside OBD.
 */
export function computeHealth(i: HealthInput): HealthResult {
  const f: HealthFactor[] = [];
  if (i.milOn) f.push({ label: "Check-engine light is on", points: 25, tone: "defect" });
  if (i.stored.length) f.push({ label: `${i.stored.length} stored trouble code${i.stored.length > 1 ? "s" : ""}`, points: Math.min(30, 12 * i.stored.length), tone: "defect" });
  if (i.pending.length) f.push({ label: `${i.pending.length} pending code${i.pending.length > 1 ? "s" : ""}`, points: Math.min(16, 8 * i.pending.length), tone: "attention" });
  const extraPermanent = (i.permanent ?? []).filter((c) => !i.stored.includes(c));
  if (extraPermanent.length) f.push({ label: "Permanent codes from a recent fault", points: 6, tone: "attention" });
  const incomplete = i.readiness?.monitors.filter((m) => !m.complete) ?? [];
  if (incomplete.length) f.push({ label: `${incomplete.length} self-test${incomplete.length > 1 ? "s" : ""} not finished`, points: Math.min(12, 4 * incomplete.length), tone: "attention" });
  const failed = (i.mode06 ?? []).filter((t) => !t.passed);
  if (failed.length) f.push({ label: `${failed.length} on-board test${failed.length > 1 ? "s" : ""} outside limits`, points: Math.min(20, 8 * failed.length), tone: "defect" });
  const trim = (i.ltft ?? 0) + (i.stft ?? 0);
  if (i.ltft != null && Math.abs(trim) > 20) f.push({ label: `Fuel trim far off (${trim > 0 ? "+" : ""}${trim.toFixed(0)} %)`, points: 15, tone: "defect" });
  else if (i.ltft != null && Math.abs(trim) > 10) f.push({ label: `Fuel trim off (${trim > 0 ? "+" : ""}${trim.toFixed(0)} %)`, points: 7, tone: "attention" });
  if (i.runningVoltage != null && i.runningVoltage < 13) f.push({ label: `Charging voltage low (${i.runningVoltage.toFixed(1)} V)`, points: 10, tone: "attention" });
  if (i.runningVoltage != null && i.runningVoltage > 15) f.push({ label: `Charging voltage high (${i.runningVoltage.toFixed(1)} V)`, points: 10, tone: "attention" });
  if (i.coolant != null && i.coolant > 110) f.push({ label: `Engine hot (${Math.round(i.coolant)} °C)`, points: 20, tone: "defect" });

  const score = Math.max(0, 100 - f.reduce((n, x) => n + x.points, 0));
  const verdict =
    score >= 90 ? "No problems OBD can see" : score >= 70 ? "Minor things to check" : score >= 45 ? "Needs a mechanic's look" : "Significant problems reported";
  return { score, verdict, factors: f };
}

export interface TamperInput {
  readiness: Readiness | null;
  distanceSinceClear: number | null | undefined;
  warmUpsSinceClear: number | null | undefined;
  /** Minutes. */
  timeSinceClear: number | null | undefined;
  distanceWithMil: number | null | undefined;
}

export interface TamperFlag {
  id: "recent_clear" | "monitors_incomplete" | "mil_history";
  title: string;
  body: string;
}

/**
 * Signs that trouble codes were cleared shortly before a sale. Each has innocent explanations too
 * (battery change, recent repair), so they're worded as questions to ask the seller.
 */
export function tamperFlags(i: TamperInput): TamperFlag[] {
  const flags: TamperFlag[] = [];
  const recentKm = typeof i.distanceSinceClear === "number" && i.distanceSinceClear < 160;
  const recentWarm = typeof i.warmUpsSinceClear === "number" && i.warmUpsSinceClear < 10;
  const recentTime = typeof i.timeSinceClear === "number" && i.timeSinceClear < 300;
  if (recentKm || recentWarm || recentTime) {
    const parts = [
      typeof i.distanceSinceClear === "number" ? `${Math.round(i.distanceSinceClear)} km` : null,
      typeof i.warmUpsSinceClear === "number" ? `${i.warmUpsSinceClear} warm-ups` : null,
    ].filter(Boolean);
    flags.push({
      id: "recent_clear",
      title: "Trouble codes were cleared recently",
      body: `Only ${parts.join(" and ")} since the codes were last cleared. Ask why: a battery change or repair can do this, but so can hiding a fault.`,
    });
  }
  const incomplete = i.readiness?.monitors.filter((m) => !m.complete) ?? [];
  if (incomplete.length >= 2) {
    flags.push({
      id: "monitors_incomplete",
      title: `${incomplete.length} emissions self-tests haven't finished`,
      body: `${incomplete.map((m) => m.name).join(", ")}. After codes are cleared these take a few days of normal driving to complete; until then a fault can stay hidden.`,
    });
  }
  if (typeof i.distanceWithMil === "number" && i.distanceWithMil > 0 && !i.readiness?.milOn) {
    flags.push({
      id: "mil_history",
      title: "The car was driven with the check-engine light on",
      body: `The ECU logged ${Math.round(i.distanceWithMil)} km with the light on, but it's off now. Ask what the fault was and how it was fixed.`,
    });
  }
  return flags;
}
