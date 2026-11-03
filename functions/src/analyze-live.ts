import { InsightCard, insightJsonSchema, validateInsights } from "../../lib/schemas/insight";
import { LiveSnapshot } from "../../lib/schemas/snapshot";
import type { MetaClient, Usage } from "./shared/meta-client";

export const SYSTEM_PROMPT = `You are an inspection assistant for a driver or used-car buyer, reading a short summary of live OBD-II data.
Rules:
- Use ONLY the data in the snapshot. Every card must cite what it is based on in evidenceRefs, using PID keys, DTC codes, or "mil" exactly as they appear in the snapshot. Those keys are for evidenceRefs only: in title, body and uncertainty write plain names ("check-engine light", "coolant temperature"), never keys like mil or coolantTemp.
- Keep three things separate through the "basis" field: "measured" (a value or code read from the car), "ai_observation" (a pattern you notice in measured data), "hypothesis" (a possible cause, unverified).
- Never conclude that a component has failed from a trouble code alone. A code points to a system to check, not a broken part.
- Never claim the car is safe or free of defects. Never recommend clearing codes.
- If a PID is listed under unsupportedPids it was not available. Do not guess its value or chart it.
- If simulated is true, the data is a demo replay. Say so in the first card's body.
- State uncertainty honestly. confidence is "low", "medium" or "high".
- Return at most 5 cards. Return an empty list if there is nothing worth saying.
- Plain language, no jargon without a short explanation.`;

export type AnalyzeResult =
  | { status: "ok"; cards: InsightCard[]; dropped: number; usage: Usage[] }
  | { status: "ai_unavailable"; usage: Usage[] };

/**
 * Analyse one snapshot. Model output is validated against the snapshot; if every card is
 * invalid the call is retried once, then reported as unavailable. Raw model text is never returned.
 */
export async function analyzeLive(rawSnapshot: unknown, client: MetaClient): Promise<AnalyzeResult> {
  const snapshot = LiveSnapshot.parse(rawSnapshot);
  const usage: Usage[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      system: SYSTEM_PROMPT,
      user: `Live snapshot (JSON):\n${JSON.stringify(snapshot)}`,
      schemaName: "insight_response",
      schema: insightJsonSchema,
    });
    usage.push(u);

    const { cards, dropped } = validateInsights(snapshot, json);
    const hadCards = Array.isArray((json as { cards?: unknown } | null)?.cards)
      ? (json as { cards: unknown[] }).cards.length > 0
      : false;
    // An empty list from the model is a valid answer. Invalid cards or unparseable output are not.
    const parsedOk = json !== null && Array.isArray((json as { cards?: unknown }).cards);
    if (parsedOk && (cards.length > 0 || !hadCards)) {
      return { status: "ok", cards, dropped, usage };
    }
  }
  return { status: "ai_unavailable", usage };
}
