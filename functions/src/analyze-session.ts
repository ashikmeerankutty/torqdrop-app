import { type SessionInput, sessionContext } from "../../lib/diagnostics/session-context";
import { type SessionAnalysis, sessionAnalysisJsonSchema, validateSessionAnalysis } from "../../lib/schemas/session";
import type { MetaClient, Usage } from "./shared/meta-client";

export const SESSION_SYSTEM_PROMPT = `You help a used-car inspector in India explain a finished inspection to a buyer.
You get the vehicle and the EVIDENCE: checks the inspector rated as needing attention or defective, inspector-confirmed photo findings, OBD trouble codes and checks that were not inspected.
Rules:
- Use only the evidence given. Never add faults, causes or parts that are not in it.
- Never say the car is safe, sound or free of problems. Unchecked items are unknowns, not passes.
- A trouble code names a failed check, not a failed part. Never diagnose a part from a code alone.
- overview: 2-4 short sentences in plain language: the most important issues first, then what was not checked.
- hypotheses: up to 5 connections between pieces of evidence (e.g. a misfire code together with rough idle), each phrased as a possibility ("may", "could"), with what to check next.
- evidenceRefs must be copied exactly from the [ref] tags in the evidence. Every hypothesis needs at least one.
- basis: "measured" for OBD codes, "inspector_observed" for rated checks, "ai_observation" for confirmed photo findings.
- confidence is "low", "medium" or "high", never a number.
- If there is nothing flagged, say so plainly, mention what was not inspected, and return no hypotheses.`;

export type SessionResult =
  | { status: "ok"; analysis: SessionAnalysis; dropped: number; context: string; usage: Usage[] }
  | { status: "ai_unavailable"; usage: Usage[] };

/** Plain-language summary and hypotheses over the whole inspection. Validated; retried once; never raw text. */
export async function summarizeSession(input: SessionInput, client: MetaClient): Promise<SessionResult> {
  const { text, refs } = sessionContext(input);
  const usage: Usage[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      system: SESSION_SYSTEM_PROMPT,
      user: `${text}\n\nSummarise this inspection for the buyer.`,
      schemaName: "session_analysis",
      schema: sessionAnalysisJsonSchema,
    });
    usage.push(u);
    const result = validateSessionAnalysis(json, refs);
    if (result) return { status: "ok", ...result, context: text, usage };
  }
  return { status: "ai_unavailable", usage };
}
