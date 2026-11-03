import type { PhotoEvidence } from "./inspections";

/** Uploaded and not yet (successfully) checked by the AI. Mirrors needsAnalysis on the server. */
export function needsAiCheck(p: PhotoEvidence): boolean {
  return p.uploadState === "uploaded" && (!p.aiAnalysis || p.aiAnalysis.status === "ai_unavailable");
}
