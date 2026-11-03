import { describeDtc } from "../../lib/diagnostics/dtc-database";
import { redactFreeText, SYMPTOMS } from "../../lib/diagnostics/symptoms";
import { type DiagnoseRequest, type Diagnosis, diagnosisJsonSchema, validateDiagnosis } from "../../lib/schemas/diagnosis";
import type { MetaClient, Usage } from "./shared/meta-client";

export const DIAGNOSE_SYSTEM_PROMPT = `You help a car owner in India understand trouble codes and symptoms. You are not a mechanic and cannot see the car.
Rules:
- A trouble code names a failed self-test, not a failed part. Explain what the test checks, then list possible causes, most common first. Never state that a specific part has failed.
- Use only the codes, symptoms, description and live data given. Do not invent readings.
- possibleCauses and possibilities are possibilities ("could", "may"). Give honest confidence: "low", "medium" or "high".
- driveAdvice: "stop" if driving could cause damage or danger (misfire with a flashing check-engine light, overheating, brakes, oil pressure); "caution" if it is safe to drive gently to a mechanic soon; "ok" only for minor issues. When unsure, choose the more cautious option.
- Never recommend clearing codes to fix a problem. Never claim the car is safe.
- checks are what a mechanic would test to find the real cause; nextSteps are practical things the owner can do now.
- possibilities[].basedOn must use the [ref] tags exactly as given.
- If the live data is SIMULATED, say so in the summary.
- Explain every code given, once each. Plain language; explain any jargon briefly.`;

/** The request as tagged lines for the model, with personal details stripped from free text. */
export function diagnoseContext(req: DiagnoseRequest): string {
  const lines: string[] = [];
  const v = req.vehicle;
  if (v) lines.push(`Vehicle: ${[v.year, v.make, v.model, v.fuel].filter(Boolean).join(" ")}`);

  lines.push("", "Trouble codes:");
  if (!req.codes.length) lines.push("- none given");
  for (const c of req.codes) {
    const info = describeDtc(c);
    lines.push(`- [${c}] ${info.title}${info.manufacturerSpecific ? " (manufacturer-specific code; meaning varies by make)" : ""}`);
  }

  lines.push("", "Symptoms:");
  if (!req.symptoms.length && !req.description?.trim()) lines.push("- none given");
  for (const s of req.symptoms) lines.push(`- [${s}] ${SYMPTOMS[s]}`);
  if (req.description?.trim()) lines.push(`- [description] Owner says: "${redactFreeText(req.description)}"`);

  const s = req.snapshot;
  if (s) {
    lines.push("", `Live data over the last ${s.windowSeconds} s${s.simulated ? " (SIMULATED demo data)" : ""}:`);
    lines.push(`- [mil] check-engine light ${s.mil.on ? "ON" : "off"}`);
    for (const [k, p] of Object.entries(s.pids)) {
      lines.push(`- [${k}] last ${p.last} ${p.unit} (min ${p.min}, avg ${p.avg}, max ${p.max})`);
    }
    if (s.unsupportedPids.length) lines.push(`- not supported by this car: ${s.unsupportedPids.join(", ")}`);
  }
  return lines.join("\n");
}

export type DiagnoseResult =
  | { status: "ok"; diagnosis: Diagnosis; dropped: number; usage: Usage[] }
  | { status: "ai_unavailable"; usage: Usage[] };

/** Explain codes and symptoms. Validated against the request; retried once; never raw text. */
export async function explainDiagnostics(req: DiagnoseRequest, client: MetaClient): Promise<DiagnoseResult> {
  const usage: Usage[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      system: DIAGNOSE_SYSTEM_PROMPT,
      user: `${diagnoseContext(req)}\n\nExplain this for the owner.`,
      schemaName: "diagnosis",
      schema: diagnosisJsonSchema,
    });
    usage.push(u);
    const result = validateDiagnosis(json, req);
    if (result) return { status: "ok", ...result, usage };
  }
  return { status: "ai_unavailable", usage };
}
