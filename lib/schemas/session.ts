import { z } from "zod";

/** One reading of the evidence as a whole. The model rewords and connects; it never adds facts. */
export const SessionHypothesis = z.object({
  statement: z.string().min(1).max(220),
  /** measured = OBD or a measurement; inspector_observed = a check the inspector rated; ai_observation = a confirmed AI finding. */
  basis: z.enum(["measured", "inspector_observed", "ai_observation"]),
  confidence: z.enum(["low", "medium", "high"]),
  /** Refs from the evidence list: "section/item" keys or DTC codes. At least one. */
  evidenceRefs: z.array(z.string().max(60)).min(1).max(6),
  nextStep: z.string().max(200),
});
export type SessionHypothesis = z.infer<typeof SessionHypothesis>;

export const SessionAnalysis = z.object({
  /** Two to four plain sentences a buyer can read. */
  overview: z.string().min(1).max(700),
  hypotheses: z.array(SessionHypothesis).max(5),
});
export type SessionAnalysis = z.infer<typeof SessionAnalysis>;

export const sessionAnalysisJsonSchema = z.toJSONSchema(SessionAnalysis);

/**
 * Validate raw model output against the schema and the evidence actually given. A hypothesis citing
 * anything not in `allowedRefs` is dropped. Returns null if the envelope is unusable. Never throws.
 */
export function validateSessionAnalysis(
  raw: unknown,
  allowedRefs: Set<string>,
): { analysis: SessionAnalysis; dropped: number } | null {
  const envelope = z.object({ overview: z.string().min(1), hypotheses: z.array(z.unknown()) }).safeParse(raw);
  if (!envelope.success) return null;
  const hypotheses: SessionHypothesis[] = [];
  let dropped = 0;
  for (const h of envelope.data.hypotheses) {
    const parsed = SessionHypothesis.safeParse(h);
    if (parsed.success && parsed.data.evidenceRefs.every((r) => allowedRefs.has(r)) && hypotheses.length < 5) {
      hypotheses.push(parsed.data);
    } else dropped++;
  }
  return { analysis: { overview: envelope.data.overview.slice(0, 700), hypotheses }, dropped };
}
