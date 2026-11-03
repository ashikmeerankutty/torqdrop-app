import { z } from "zod";

import { evaluateSafety, type SafetyBanner } from "../diagnostics/safety-rules";
import { SYMPTOM_KEYS } from "../diagnostics/symptoms";
import { FindingSeverity } from "./finding";
import { LiveSnapshot } from "./snapshot";

/** Standard OBD-II code: system letter, then four hex digits. */
export const DTC_CODE = /^[PCBU][0-3][0-9A-F]{3}$/;

export const DiagnoseRequest = z
  .object({
    codes: z.array(z.string().regex(DTC_CODE)).max(8).default([]),
    symptoms: z.array(z.enum(SYMPTOM_KEYS)).max(12).default([]),
    description: z.string().max(500).optional(),
    vehicle: z
      .object({
        make: z.string().max(40),
        model: z.string().max(40),
        year: z.number().int().min(1980).max(2100).optional(),
        fuel: z.string().max(20).optional(),
      })
      .optional(),
    /** Live data when a car is connected, so the explanation can use what the car is doing now. */
    snapshot: LiveSnapshot.optional(),
  })
  .refine((r) => r.codes.length > 0 || r.symptoms.length > 0 || !!r.description?.trim(), {
    message: "Give at least one trouble code or symptom",
  });
export type DiagnoseRequest = z.infer<typeof DiagnoseRequest>;

export const DriveAdvice = z.enum(["ok", "caution", "stop"]);
export type DriveAdvice = z.infer<typeof DriveAdvice>;

export const CodeExplanation = z.object({
  code: z.string().regex(DTC_CODE),
  /** What the code means in plain words: the test that failed, not a broken part. */
  meaning: z.string().min(1).max(300),
  possibleCauses: z.array(z.string().max(120)).min(1).max(4),
  severity: FindingSeverity,
  driveAdvice: DriveAdvice,
  driveNote: z.string().max(200),
  /** What a mechanic would check to find the actual cause. */
  checks: z.array(z.string().max(120)).max(4),
});
export type CodeExplanation = z.infer<typeof CodeExplanation>;

export const Possibility = z.object({
  statement: z.string().min(1).max(220),
  /** Codes, symptom keys, PID keys or "description" from the request. */
  basedOn: z.array(z.string().max(40)).min(1).max(6),
  confidence: z.enum(["low", "medium", "high"]),
});
export type Possibility = z.infer<typeof Possibility>;

export const Diagnosis = z.object({
  summary: z.string().min(1).max(500),
  codes: z.array(CodeExplanation).max(8),
  possibilities: z.array(Possibility).max(4),
  nextSteps: z.array(z.string().max(160)).max(4),
  driveAdvice: DriveAdvice,
});
export type Diagnosis = z.infer<typeof Diagnosis>;

export const diagnosisJsonSchema = z.toJSONSchema(Diagnosis);

/** Everything the model may cite: the request's codes, symptoms, PIDs, "mil" and "description". */
export function diagnosisRefs(req: DiagnoseRequest): Set<string> {
  const refs = new Set<string>([...req.codes, ...req.symptoms]);
  if (req.description?.trim()) refs.add("description");
  if (req.snapshot) {
    for (const k of Object.keys(req.snapshot.pids)) refs.add(k);
    for (const c of [...req.snapshot.dtcs.stored, ...req.snapshot.dtcs.pending]) refs.add(c);
    refs.add("mil");
  }
  return refs;
}

/** The deterministic safety banners for this request. They never depend on the model. */
export function requestSafety(req: DiagnoseRequest): SafetyBanner[] {
  const s = req.snapshot;
  return evaluateSafety({
    milOn: s?.mil.on ?? false,
    stored: [...new Set([...req.codes, ...(s?.dtcs.stored ?? [])])],
    pending: s?.dtcs.pending ?? [],
    coolantTemp: s?.pids.coolantTemp?.last ?? null,
  });
}

const DRIVE_RANK: Record<DriveAdvice, number> = { ok: 0, caution: 1, stop: 2 };
const stricter = (a: DriveAdvice, b: DriveAdvice) => (DRIVE_RANK[b] > DRIVE_RANK[a] ? b : a);

/**
 * Validate model output against the schema and the request. Codes not asked about, duplicates and
 * possibilities citing unknown refs are dropped. Drive advice is raised, never lowered, to match the
 * safety rules. Returns null if the envelope is unusable. Never throws.
 */
export function validateDiagnosis(raw: unknown, req: DiagnoseRequest): { diagnosis: Diagnosis; dropped: number } | null {
  const envelope = z
    .object({
      summary: z.string().min(1),
      codes: z.array(z.unknown()),
      possibilities: z.array(z.unknown()),
      nextSteps: z.array(z.unknown()),
      driveAdvice: DriveAdvice,
    })
    .safeParse(raw);
  if (!envelope.success) return null;
  let dropped = 0;

  const asked = new Set(req.codes);
  const codes: CodeExplanation[] = [];
  for (const c of envelope.data.codes) {
    const parsed = CodeExplanation.safeParse(c);
    if (parsed.success && asked.has(parsed.data.code) && !codes.some((x) => x.code === parsed.data.code)) codes.push(parsed.data);
    else dropped++;
  }

  const refs = diagnosisRefs(req);
  const possibilities: Possibility[] = [];
  for (const p of envelope.data.possibilities) {
    const parsed = Possibility.safeParse(p);
    if (parsed.success && parsed.data.basedOn.every((r) => refs.has(r)) && possibilities.length < 4) possibilities.push(parsed.data);
    else dropped++;
  }

  const nextSteps = envelope.data.nextSteps.filter((s): s is string => typeof s === "string" && s.length <= 160).slice(0, 4);

  // Safety floor: an urgent banner means stop; any banner means at least caution.
  const banners = requestSafety(req);
  const floor: DriveAdvice = banners.some((b) => b.severity === "urgent") ? "stop" : banners.length ? "caution" : "ok";
  const urgentCodes = new Set(banners.filter((b) => b.severity === "urgent").flatMap((b) => b.refs));
  for (const c of codes) {
    if (urgentCodes.has(c.code)) {
      c.driveAdvice = "stop";
      if (c.severity !== "urgent") c.severity = "urgent";
    }
  }

  let driveAdvice = stricter(envelope.data.driveAdvice, floor);
  for (const c of codes) driveAdvice = stricter(driveAdvice, c.driveAdvice);

  return {
    diagnosis: { summary: envelope.data.summary.slice(0, 500), codes, possibilities, nextSteps, driveAdvice },
    dropped,
  };
}
