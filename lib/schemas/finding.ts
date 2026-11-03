import { z } from "zod";

export const FindingSeverity = z.enum(["info", "monitor", "attention", "urgent"]);

/** One thing the model saw in a photo. Stored as an `ai_suggested` finding until an inspector confirms it. */
export const PhotoFinding = z.object({
  /** What is visible, in plain words. Never a hidden fault. */
  observedCondition: z.string().min(1).max(200),
  severity: FindingSeverity,
  /** Qualitative on purpose: a model's own probabilities are not calibrated. */
  confidence: z.enum(["low", "medium", "high"]),
  /** What it might mean. Phrased as a possibility, not a diagnosis. */
  aiInterpretation: z.string().max(300),
  uncertainty: z.string().max(200),
  /** What else the inspector should capture or check to confirm. */
  missingEvidence: z.array(z.string().max(120)).max(5),
  nextAction: z.string().max(200),
});
export type PhotoFinding = z.infer<typeof PhotoFinding>;

export const PhotoAnalysis = z.object({
  /** False when the photo is too dark, blurred, or doesn't show the part being checked. */
  imageUsable: z.boolean(),
  unusableReason: z.string().max(200).optional(),
  findings: z.array(PhotoFinding).max(3),
});
export type PhotoAnalysis = z.infer<typeof PhotoAnalysis>;

/** JSON Schema for the Meta API `response_format.json_schema.schema` field. */
export const photoAnalysisJsonSchema = z.toJSONSchema(PhotoAnalysis);

/**
 * Validate raw model output. Findings that fail the schema are dropped individually;
 * returns null if the envelope itself is unusable. Never throws.
 */
export function validatePhotoAnalysis(raw: unknown): { analysis: PhotoAnalysis; dropped: number } | null {
  const envelope = z
    .object({ imageUsable: z.boolean(), unusableReason: z.string().optional(), findings: z.array(z.unknown()) })
    .safeParse(raw);
  if (!envelope.success) return null;
  const findings: PhotoFinding[] = [];
  let dropped = 0;
  for (const f of envelope.data.findings) {
    const parsed = PhotoFinding.safeParse(f);
    if (parsed.success && findings.length < 3) findings.push(parsed.data);
    else dropped++;
  }
  const { imageUsable, unusableReason } = envelope.data;
  return {
    analysis: { imageUsable, ...(unusableReason ? { unusableReason: unusableReason.slice(0, 200) } : {}), findings: imageUsable ? findings : [] },
    dropped,
  };
}
