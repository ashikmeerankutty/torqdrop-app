import { getSection } from "../../lib/diagnostics/checklists/ppi-v1";
import { PAINT_OPTIONS, STRUCTURE_OPTIONS } from "../../lib/diagnostics/checklists/types";
import { photoAnalysisJsonSchema, type PhotoAnalysis, validatePhotoAnalysis } from "../../lib/schemas/finding";
import type { MetaClient, Usage } from "./shared/meta-client";

export const PHOTO_SYSTEM_PROMPT = `You assist a used-car inspector in India. You are shown ONE photo taken for ONE checklist item.
Rules:
- Describe only what is visible in this photo. Never claim hidden damage, internal faults or anything not shown.
- Never claim the car or part is safe or free of defects. Absence of a visible problem is not proof there is none.
- If the photo is too dark, blurred, too far away, or does not show the item, set imageUsable to false, give unusableReason, and return no findings.
- Return at most 3 findings, only for things that matter for this item. Return an empty list if nothing notable is visible.
- severity: "info" (normal or cosmetic note), "monitor" (minor, watch it), "attention" (should be checked or priced in), "urgent" (safety concern).
- aiInterpretation is a possibility, not a diagnosis ("may indicate", "consistent with"). Say what else could explain it.
- confidence is "low", "medium" or "high". State uncertainty honestly; a single photo is rarely conclusive.
- missingEvidence lists what to capture or check to confirm (another angle, close-up, paint-thickness gauge, test drive).
- nextAction is one practical step for the inspector.
- Ignore number plates, VINs and people; never transcribe them.
- Plain language, short sentences.`;

/** The checklist item the photo was taken for, as context for the model. */
export function itemContext(sectionKey: string, itemKey: string): string | null {
  const section = getSection(sectionKey);
  const item = section?.items.find((i) => i.key === itemKey);
  if (!section || !item) return null;
  const options =
    item.input.kind === "choice"
      ? item.input.options.map((o) => o.label).join(" / ")
      : item.input.kind === "panel"
        ? `paint: ${PAINT_OPTIONS.map((o) => o.label).join(" / ")}; structure: ${STRUCTURE_OPTIONS.map((o) => o.label).join(" / ")}`
        : item.input.kind === "tread"
          ? "tread depth in mm (1.6 mm legal minimum)"
          : null;
  return `Section: ${section.title}\nItem: ${item.label}${options ? `\nThe inspector rates it as: ${options}` : ""}`;
}

export type PhotoResult =
  | { status: "ok"; analysis: PhotoAnalysis; dropped: number; usage: Usage[] }
  | { status: "ai_unavailable"; usage: Usage[] };

/**
 * Analyse one inspection photo. Output is schema-validated; unparseable output is retried once,
 * then reported as unavailable. Raw model text is never returned.
 */
export async function analyzePhoto(
  input: { sectionKey: string; itemKey: string; image: Buffer; mime: string },
  client: MetaClient,
): Promise<PhotoResult> {
  const context = itemContext(input.sectionKey, input.itemKey);
  if (!context) throw new Error(`Unknown checklist item ${input.sectionKey}/${input.itemKey}`);
  const usage: Usage[] = [];
  const dataUrl = `data:${input.mime};base64,${input.image.toString("base64")}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      system: PHOTO_SYSTEM_PROMPT,
      user: [
        { type: "text", text: `${context}\n\nReport what this photo shows for this item.` },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
      schemaName: "photo_analysis",
      schema: photoAnalysisJsonSchema,
    });
    usage.push(u);
    const result = validatePhotoAnalysis(json);
    if (result) return { status: "ok", ...result, usage };
  }
  return { status: "ai_unavailable", usage };
}
