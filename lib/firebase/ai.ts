import { getFunctions, httpsCallable } from "@react-native-firebase/functions";

import type { Verdict } from "@/lib/diagnostics/evidence-engine";
import type { SafetyBanner } from "@/lib/diagnostics/safety-rules";
import type { DiagnoseRequest, Diagnosis } from "@/lib/schemas/diagnosis";
import type { DocumentKind, DocumentScan } from "@/lib/schemas/document";
import type { EngineClipContext, EngineSoundResult } from "@/lib/schemas/engine-sound";
import type { InsightCard } from "@/lib/schemas/insight";
import type { SessionAnalysis } from "@/lib/schemas/session";
import type { LiveSnapshot } from "@/lib/schemas/snapshot";

const functions = () => getFunctions(undefined, "asia-south1");

export type SectionCheckResult = {
  status: "ok";
  analyzed: number;
  failed: number;
  waitingForUpload: number;
  overCap: number;
  cap: number;
};

/**
 * The AI check for a section: every uploaded photo not yet checked. Findings are written by the
 * function and reach screens through their listeners.
 */
export async function analyzeSectionPhotos(inspectionId: string, sectionKey: string): Promise<SectionCheckResult> {
  const call = httpsCallable<{ inspectionId: string; sectionKey: string }, SectionCheckResult>(functions(), "analyzeSectionPhotos", {
    timeout: 540_000,
  });
  return (await call({ inspectionId, sectionKey })).data;
}

export type LiveInsightResult = { status: "ok"; cards: InsightCard[] } | { status: "ai_unavailable" };

export async function analyzeLiveSnapshot(snapshot: LiveSnapshot): Promise<LiveInsightResult> {
  const call = httpsCallable<{ snapshot: LiveSnapshot }, LiveInsightResult>(functions(), "analyzeLiveSnapshot", {
    timeout: 60_000,
  });
  return (await call({ snapshot })).data;
}

export type SessionSummaryResult = ({ status: "ok" } & SessionAnalysis) | { status: "ai_unavailable" };

/** The function stores the summary on the inspection; the screen picks it up through its listener. */
export async function analyzeSession(inspectionId: string): Promise<SessionSummaryResult> {
  const call = httpsCallable<{ inspectionId: string }, SessionSummaryResult>(functions(), "analyzeSession", {
    timeout: 120_000,
  });
  return (await call({ inspectionId })).data;
}

/** Runs the completion gate on the server, then signs off and locks the inspection. */
export async function finalizeReport(
  inspectionId: string,
  inspectorName: string,
): Promise<{ status: "ok"; reportId: string; verdict: Verdict }> {
  const call = httpsCallable<{ inspectionId: string; inspectorName: string }, { status: "ok"; reportId: string; verdict: Verdict }>(
    functions(),
    "finalizeReport",
    { timeout: 60_000 },
  );
  return (await call({ inspectionId, inspectorName })).data;
}

export type DiagnoseResult =
  | { status: "ok"; diagnosis: Diagnosis; safety: SafetyBanner[]; simulated: boolean }
  | { status: "ai_unavailable"; safety: SafetyBanner[] };

/** Plain-language explanation of trouble codes and symptoms. */
export async function explainDtc(req: Partial<DiagnoseRequest>): Promise<DiagnoseResult> {
  const call = httpsCallable<Partial<DiagnoseRequest>, DiagnoseResult>(functions(), "explainDtc", { timeout: 90_000 });
  return (await call(req)).data;
}

export type ScanResult = { status: "ok"; scan: DocumentScan } | { status: "ai_unavailable" };

/** Reads an RC or insurance policy from a JPEG (base64). Returns fields for the inspector to confirm. */
export async function scanDocument(kind: DocumentKind, imageBase64: string): Promise<ScanResult> {
  const call = httpsCallable<{ kind: DocumentKind; imageBase64: string }, ScanResult>(functions(), "scanDocument", {
    timeout: 90_000,
  });
  return (await call({ kind, imageBase64 })).data;
}

export type EngineClipResult =
  | { status: "ok"; result: EngineSoundResult; safety: SafetyBanner[]; simulated: boolean }
  | { status: "ai_unavailable"; safety: SafetyBanner[] };

/** Analyse an engine clip already uploaded to engine-clips/{uid}/{clipId}.mp4. The server deletes the clip afterwards. */
export async function analyzeEngineClip(clipId: string, context: EngineClipContext): Promise<EngineClipResult> {
  const call = httpsCallable<{ clipId: string; context: EngineClipContext }, EngineClipResult>(functions(), "analyzeEngineClip", {
    timeout: 300_000,
  });
  return (await call({ clipId, context })).data;
}

/** A link anyone can open to view the report, until `expiresAt` (epoch ms). */
export async function createReportLink(reportId: string): Promise<{ url: string; expiresAt: number }> {
  const call = httpsCallable<{ reportId: string }, { url: string; expiresAt: number }>(functions(), "createReportLink", {
    timeout: 30_000,
  });
  return (await call({ reportId })).data;
}

/** The server's list of what blocks sign-off, when finalizeReport refuses. */
export function blockersFromError(e: unknown): string[] {
  const details = (e as { details?: { blockers?: unknown } })?.details;
  return Array.isArray(details?.blockers) ? details.blockers.filter((b): b is string => typeof b === "string") : [];
}

/** User-facing message for a failed callable. Firebase errors carry codes like functions/resource-exhausted. */
export function aiErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  if (code.endsWith("resource-exhausted")) return (e as Error).message;
  if (code.endsWith("failed-precondition")) return (e as Error).message;
  if (code.endsWith("unauthenticated") || code.endsWith("permission-denied")) {
    // Also what a just-deployed function returns until its public-invoke permission takes effect.
    return __DEV__
      ? "The server refused the request. If the function was just deployed, wait a minute and retry; otherwise check the App Check debug token."
      : "This app couldn't be verified. Try again in a moment.";
  }
  if (code.endsWith("aborted")) return (e as Error).message;
  if (code.endsWith("unavailable") || code.endsWith("deadline-exceeded")) return "AI is unavailable right now. Try again.";
  return "Something went wrong asking the AI. Try again.";
}
