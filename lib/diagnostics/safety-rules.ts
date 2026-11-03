/**
 * Deterministic safety rules. They run on the live stream (and again on the server), never wait on
 * the model, and never depend on it.
 */

export interface SafetyInput {
  milOn: boolean;
  stored: string[];
  pending: string[];
  /** °C, or null/undefined when unsupported or not read yet. */
  coolantTemp?: number | null;
}

export interface SafetyBanner {
  id: string;
  severity: "urgent" | "attention";
  title: string;
  body: string;
  /** Codes or PID keys this banner is based on. */
  refs: string[];
}

/** Above this the engine is overheating. Normal running is roughly 85–105 °C. */
export const COOLANT_URGENT_C = 115;
export const COOLANT_HIGH_C = 105;

const MISFIRE = /^P030[0-8]$/;

export function evaluateSafety(input: SafetyInput): SafetyBanner[] {
  const banners: SafetyBanner[] = [];
  const codes = [...input.stored, ...input.pending];

  const misfires = codes.filter((c) => MISFIRE.test(c));
  if (misfires.length) {
    banners.push({
      id: "misfire",
      severity: "urgent",
      title: "Engine misfire detected",
      body: "Avoid driving until it is checked. A misfire can overheat and damage the catalytic converter. Do not rev the engine or drive under load.",
      refs: [...new Set(misfires)],
    });
  }

  const coolant = input.coolantTemp;
  if (coolant != null && coolant >= COOLANT_URGENT_C) {
    banners.push({
      id: "overheating",
      severity: "urgent",
      title: "Engine overheating",
      body: `Coolant is at ${Math.round(coolant)} °C. Stop safely and switch off the engine. Do not open the radiator cap while it is hot.`,
      refs: ["coolantTemp"],
    });
  } else if (coolant != null && coolant >= COOLANT_HIGH_C) {
    banners.push({
      id: "coolant_high",
      severity: "attention",
      title: "Coolant temperature high",
      body: `Coolant is at ${Math.round(coolant)} °C, above the normal range. Watch it, and stop if it keeps rising.`,
      refs: ["coolantTemp"],
    });
  }

  if (input.milOn && !misfires.length) {
    banners.push({
      id: "mil",
      severity: "attention",
      title: "Check-engine light is on",
      body: "The engine computer has stored a fault. See the trouble codes below.",
      refs: ["mil"],
    });
  }

  return banners;
}
