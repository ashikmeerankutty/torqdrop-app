import { z } from "zod";
import { LiveSnapshot, snapshotRefs } from "./snapshot";

/**
 * How much weight a card deserves. The UI keeps these visually separate:
 *  measured     = a number or code read from the car
 *  ai_observation = something the model noticed in measured data
 *  hypothesis   = a possible cause, unverified
 */
export const Basis = z.enum(["measured", "ai_observation", "hypothesis"]);
export const Severity = z.enum(["info", "monitor", "attention", "urgent"]);

export const ChartHint = z.object({
  pid: z.string(),
  /** Seconds of history to show. */
  windowSeconds: z.number().int().min(10).max(3600),
});

export const InsightCard = z.object({
  kind: z.enum(["insight", "warning", "check_next"]),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(400),
  basis: Basis,
  severity: Severity,
  /** Qualitative on purpose: a model's own probabilities are not calibrated. */
  confidence: z.enum(["low", "medium", "high"]),
  uncertainty: z.string().max(200),
  /** PID keys / DTC codes / "mil" from the snapshot that this card is based on. */
  evidenceRefs: z.array(z.string()).min(1),
  chart: ChartHint.optional(),
});
export type InsightCard = z.infer<typeof InsightCard>;

export const InsightResponse = z.object({
  cards: z.array(InsightCard).max(5),
});
export type InsightResponse = z.infer<typeof InsightResponse>;

/** JSON Schema for the Meta API `response_format.json_schema.schema` field. */
export const insightJsonSchema = z.toJSONSchema(InsightResponse);

const SEVERITY_ORDER = { urgent: 0, attention: 1, monitor: 2, info: 3 } as const;

/**
 * Validate raw model output against the snapshot it was given.
 * Returns the cards that survive; never throws. Cards are dropped when they:
 *  - fail the schema,
 *  - cite evidence that is not in the snapshot (a hallucinated PID or code),
 *  - ask for a chart of a PID the vehicle does not support.
 */
export function validateInsights(
  snapshot: LiveSnapshot,
  raw: unknown,
): { cards: InsightCard[]; dropped: number } {
  const parsed = z.object({ cards: z.array(z.unknown()) }).safeParse(raw);
  if (!parsed.success) return { cards: [], dropped: 0 };

  const refs = snapshotRefs(snapshot);
  const cards: InsightCard[] = [];
  let dropped = 0;
  for (const item of parsed.data.cards) {
    const card = InsightCard.safeParse(item);
    const ok =
      card.success &&
      card.data.evidenceRefs.every((r) => refs.has(r)) &&
      (!card.data.chart || card.data.chart.pid in snapshot.pids);
    if (ok) cards.push(card.data);
    else dropped++;
  }
  cards.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { cards: cards.slice(0, 5), dropped };
}
