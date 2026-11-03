import { z } from "zod";

import { evaluateSafety, type SafetyBanner } from "../diagnostics/safety-rules";
import { DriveAdvice } from "./diagnosis";
import { FindingSeverity } from "./finding";

/** Longest clip the app records. Short enough to upload on mobile data and to keep AI cost bounded. */
export const MAX_CLIP_SECONDS = 20;
export const MIN_CLIP_SECONDS = 5;
/** Raw MP4 limit. Base64 adds a third, which must stay under the model API's 50 MB inline limit. */
export const MAX_CLIP_BYTES = 30 * 1024 * 1024;

/** What the owner is worried about, tapped before recording. Keys are shown to the AI. */
export const ENGINE_CONCERNS = {
  knocking: "Knocking or pinging",
  ticking: "Ticking or tapping",
  squealing: "Squealing or chirping",
  whining: "Whining",
  rattling: "Rattling",
  hissing: "Hissing",
  grinding: "Grinding",
  rough_idle: "Rough or shaky idle",
  smoke: "Smoke",
  leak: "Leak or drip",
} as const;
export type EngineConcern = keyof typeof ENGINE_CONCERNS;
export const ENGINE_CONCERN_KEYS = Object.keys(ENGINE_CONCERNS) as [EngineConcern, ...EngineConcern[]];

export const CLIP_PLACES = {
  engine_bay: "Engine bay, bonnet open",
  exhaust: "At the exhaust pipe",
  cabin: "Inside the car",
  under_car: "Under the car",
} as const;
export type ClipPlace = keyof typeof CLIP_PLACES;

/** Sounds the model may report. A closed list keeps the result screen and history consistent. */
export const ENGINE_SOUNDS = {
  knock: "Knocking",
  ping: "Pinging (pre-ignition)",
  tick: "Ticking",
  squeal: "Belt squeal",
  whine: "Whine",
  rattle: "Rattle",
  hiss: "Hiss",
  grind: "Grinding",
  misfire: "Uneven firing (misfire)",
  exhaust_leak: "Exhaust leak puffing",
  other: "Other sound",
} as const;
export type EngineSound = keyof typeof ENGINE_SOUNDS;
const ENGINE_SOUND_KEYS = Object.keys(ENGINE_SOUNDS) as [EngineSound, ...EngineSound[]];

/** One OBD reading taken while the clip was recorded, `t` seconds after it started. */
export const ObdTracePoint = z.object({
  t: z.number().min(0).max(MAX_CLIP_SECONDS + 5),
  rpm: z.number().min(0).max(16_000).optional(),
  engineLoad: z.number().min(0).max(100).optional(),
  throttle: z.number().min(0).max(100).optional(),
  coolantTemp: z.number().min(-40).max(215).optional(),
  shortFuelTrim1: z.number().min(-100).max(100).optional(),
  longFuelTrim1: z.number().min(-100).max(100).optional(),
  map: z.number().min(0).max(255).optional(),
  maf: z.number().min(0).max(700).optional(),
});
export type ObdTracePoint = z.infer<typeof ObdTracePoint>;

export const EngineClipContext = z.object({
  durationS: z.number().min(MIN_CLIP_SECONDS - 1).max(MAX_CLIP_SECONDS + 2),
  place: z.enum(Object.keys(CLIP_PLACES) as [ClipPlace, ...ClipPlace[]]),
  engineWarm: z.boolean().nullable(),
  concerns: z.array(z.enum(ENGINE_CONCERN_KEYS)).max(10).default([]),
  description: z.string().max(300).optional(),
  vehicle: z
    .object({
      make: z.string().max(40).nullable(),
      model: z.string().max(40).nullable(),
      year: z.number().int().min(1980).max(2100).nullable(),
      fuel: z.string().max(20).nullable(),
      displacementL: z.number().min(0.3).max(10).nullable(),
      odometerKm: z.number().min(0).max(3_000_000).nullable(),
    })
    .optional(),
  /** Live data from the adapter during the clip, when connected. */
  obd: z
    .object({
      simulated: z.boolean(),
      milOn: z.boolean(),
      stored: z.array(z.string().max(8)).max(20),
      pending: z.array(z.string().max(8)).max(20),
      trace: z.array(ObdTracePoint).max(60),
    })
    .optional(),
});
export type EngineClipContext = z.infer<typeof EngineClipContext>;

export const AnalyzeEngineClipRequest = z.object({
  /** The upload's file name under engine-clips/{uid}/. */
  clipId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  context: EngineClipContext,
});
export type AnalyzeEngineClipRequest = z.infer<typeof AnalyzeEngineClipRequest>;

export const HeardSound = z.object({
  kind: z.enum(ENGINE_SOUND_KEYS),
  /** Seconds into the clip where it is clearest. */
  fromS: z.number().min(0).nullable(),
  toS: z.number().min(0).nullable(),
  /** What it sounds like and when it happens (idle, on the rev, steady or rhythmic). */
  description: z.string().min(1).max(240),
  likelySources: z.array(z.string().max(100)).min(1).max(3),
  confidence: z.enum(["low", "medium", "high"]),
  severity: FindingSeverity,
});
export type HeardSound = z.infer<typeof HeardSound>;

export const SeenObservation = z.object({
  observation: z.string().min(1).max(200),
  fromS: z.number().min(0).nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});
export type SeenObservation = z.infer<typeof SeenObservation>;

export const EngineSoundResult = z.object({
  /** Could the engine be heard clearly? Poor clips should be retaken, not trusted. */
  clipQuality: z.enum(["good", "usable", "poor"]),
  qualityNote: z.string().max(200),
  summary: z.string().min(1).max(500),
  /** How steady the idle rhythm sounds: even, slightly uneven or clearly uneven. Null if not judged. */
  idleRhythm: z.enum(["even", "slightly_uneven", "uneven"]).nullable(),
  sounds: z.array(HeardSound).max(5),
  seen: z.array(SeenObservation).max(4),
  /** How the live data supports or contradicts what was heard. */
  obdNotes: z.array(z.string().max(200)).max(3),
  nextSteps: z.array(z.string().max(160)).max(4),
  driveAdvice: DriveAdvice,
});
export type EngineSoundResult = z.infer<typeof EngineSoundResult>;

export const engineSoundJsonSchema = z.toJSONSchema(EngineSoundResult);

/** Safety banners from the OBD data sent with the clip. Fixed rules; never from the model. */
export function clipSafety(ctx: EngineClipContext): SafetyBanner[] {
  const o = ctx.obd;
  if (!o) return [];
  const coolant = [...o.trace].reverse().find((p) => p.coolantTemp != null)?.coolantTemp ?? null;
  return evaluateSafety({ milOn: o.milOn, stored: o.stored, pending: o.pending, coolantTemp: coolant });
}

const DRIVE_RANK: Record<DriveAdvice, number> = { ok: 0, caution: 1, stop: 2 };
const stricter = (a: DriveAdvice, b: DriveAdvice) => (DRIVE_RANK[b] > DRIVE_RANK[a] ? b : a);

/**
 * Validate model output. Sounds and observations that don't parse are dropped one by one; times are
 * clamped to the clip. Drive advice is raised, never lowered: to the safety rules' floor, to "caution"
 * for any attention-level sound, and to "stop" for any urgent one. Returns null if unusable.
 */
export function validateEngineSound(raw: unknown, ctx: EngineClipContext): { result: EngineSoundResult; dropped: number } | null {
  const envelope = z
    .object({
      clipQuality: z.enum(["good", "usable", "poor"]),
      qualityNote: z.string().optional(),
      summary: z.string().min(1),
      idleRhythm: z.enum(["even", "slightly_uneven", "uneven"]).nullable().optional(),
      sounds: z.array(z.unknown()).default([]),
      seen: z.array(z.unknown()).default([]),
      obdNotes: z.array(z.unknown()).default([]),
      nextSteps: z.array(z.unknown()).default([]),
      driveAdvice: DriveAdvice,
    })
    .safeParse(raw);
  if (!envelope.success) return null;
  const e = envelope.data;
  let dropped = 0;
  const clampT = (t: number | null) => (t == null ? null : Math.min(Math.max(0, t), ctx.durationS));

  const sounds: HeardSound[] = [];
  for (const s of e.sounds) {
    const p = HeardSound.safeParse(s);
    if (!p.success || sounds.length >= 5) {
      dropped++;
      continue;
    }
    const fromS = clampT(p.data.fromS);
    const toS = clampT(p.data.toS);
    sounds.push({ ...p.data, fromS, toS: toS != null && fromS != null && toS < fromS ? fromS : toS });
  }

  const seen: SeenObservation[] = [];
  for (const s of e.seen) {
    const p = SeenObservation.safeParse(s);
    if (p.success && seen.length < 4) seen.push({ ...p.data, fromS: clampT(p.data.fromS) });
    else dropped++;
  }

  const strings = (xs: unknown[], max: number, n: number) => xs.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= max).slice(0, n);
  // Without live data there is nothing for OBD notes to be about.
  const obdNotes = ctx.obd ? strings(e.obdNotes, 200, 3) : [];

  const banners = clipSafety(ctx);
  let driveAdvice: DriveAdvice = e.driveAdvice;
  driveAdvice = stricter(driveAdvice, banners.some((b) => b.severity === "urgent") ? "stop" : banners.length ? "caution" : "ok");
  for (const s of sounds) {
    if (s.severity === "urgent" && s.confidence !== "low") driveAdvice = stricter(driveAdvice, "stop");
    else if (s.severity === "attention" || s.severity === "urgent") driveAdvice = stricter(driveAdvice, "caution");
  }

  return {
    result: {
      clipQuality: e.clipQuality,
      qualityNote: (e.qualityNote ?? "").slice(0, 200),
      summary: e.summary.slice(0, 500),
      idleRhythm: e.idleRhythm ?? null,
      sounds,
      seen,
      obdNotes,
      nextSteps: strings(e.nextSteps, 160, 4),
      driveAdvice,
    },
    dropped,
  };
}
