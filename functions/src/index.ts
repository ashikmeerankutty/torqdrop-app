import { initializeApp } from "firebase-admin/app";
import { type DocumentReference, FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash, randomBytes } from "node:crypto";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { analyzeLive } from "./analyze-live";
import { PPI_V1 } from "../../lib/diagnostics/checklists/ppi-v1";
import type { ItemRecord } from "../../lib/diagnostics/checklists/types";
import { type ReviewInput, reviewInspection } from "../../lib/diagnostics/evidence-engine";
import { sessionContext, sessionVehicle } from "../../lib/diagnostics/session-context";
import { renderReportHtml, type ReportData } from "../../lib/report/html-template";
import { DiagnoseRequest, requestSafety } from "../../lib/schemas/diagnosis";
import { DocumentKind } from "../../lib/schemas/document";
import { explainDiagnostics } from "./explain-dtc";
import { deleteUserData } from "./delete-account";
import { chargeForReport, checkPurchase, grantPurchase, paymentId, PlayClient, readBalance } from "./billing";
import { findPack } from "../../lib/billing/plans";
import { readDocument } from "./scan-document";
import { analyzeEvidencePhoto, analyzeSection, MAX_PHOTO_ANALYSES, photoAnalysesUsed } from "./photo-jobs";
import { summarizeSession } from "./analyze-session";
import { analyzeEngineSound } from "./engine-sound";
import { AnalyzeEngineClipRequest, clipSafety, MAX_CLIP_BYTES } from "../../lib/schemas/engine-sound";
import { MetaClient, type Usage } from "./shared/meta-client";

initializeApp();

const META_API_KEY = defineSecret("META_API_KEY");
const REGION = "asia-south1";


const totalCost = (usage: Usage[]) => usage.reduce((s, u) => s + u.costUsd, 0);

/**
 * Callable: LiveSnapshot in, validated insight cards out.
 * Requires a signed-in user and App Check. Logs token usage and cost to `aiUsage`.
 */
export const analyzeLiveSnapshot = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");

    let result;
    try {
      result = await analyzeLive(request.data?.snapshot, new MetaClient({ apiKey: META_API_KEY.value() }));
    } catch (e) {
      // Malformed snapshots are the caller's fault. Anything else is reported without raw detail.
      if (e instanceof Error && e.name === "ZodError") throw new HttpsError("invalid-argument", "Invalid snapshot");
      throw new HttpsError("unavailable", "AI unavailable");
    }

    await getFirestore().collection("aiUsage").add({
      uid: request.auth.uid,
      fn: "analyzeLive",
      usage: result.usage,
      costUsd: totalCost(result.usage),
      createdAt: FieldValue.serverTimestamp(),
    });

    if (result.status === "ai_unavailable") return { status: "ai_unavailable" as const };
    return { status: "ok" as const, cards: result.cards };
  },
);

const PhotoRequest = z.object({ inspectionId: z.string().min(1).max(128), evidenceId: z.string().min(1).max(128) });

/**
 * Callable: analyse one uploaded photo. Kept for app versions from before section-level checks;
 * current apps call analyzeSectionPhotos.
 */
export const analyzePhotoEvidence = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 120, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = PhotoRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "inspectionId and evidenceId are required");
    const { inspectionId, evidenceId } = parsed.data;
    const inspectionRef = await ownedOpenInspection(request.auth.uid, inspectionId);
    if ((await photoAnalysesUsed(inspectionId)) >= MAX_PHOTO_ANALYSES) {
      throw new HttpsError("resource-exhausted", `AI photo checks are limited to ${MAX_PHOTO_ANALYSES} per inspection`);
    }
    const r = await analyzeEvidencePhoto(request.auth.uid, inspectionRef, evidenceId, new MetaClient({ apiKey: META_API_KEY.value() }));
    if (r.status === "skipped") throw new HttpsError("failed-precondition", "This photo can't be analysed right now");
    return r;
  },
);

/** The inspection, if it belongs to `uid` and isn't signed off. Same error for missing and not-yours. */
async function ownedOpenInspection(uid: string, inspectionId: string) {
  const ref = getFirestore().doc(`inspections/${inspectionId}`);
  const inspection = await ref.get();
  if (!inspection.exists || inspection.get("ownerUid") !== uid) throw new HttpsError("not-found", "Inspection not found");
  if (inspection.get("status") === "complete") throw new HttpsError("failed-precondition", "This inspection is complete");
  return ref;
}

const SectionRequest = z.object({ inspectionId: z.string().min(1).max(128), sectionKey: z.string().min(1).max(64) });

/**
 * Callable: the AI check for a finished section. Marks the section so photos that finish uploading
 * later are checked by onPhotoUploaded, then checks every uploaded photo not yet analysed. Findings are
 * written as `ai_suggested` for the inspector to confirm or dismiss.
 */
export const analyzeSectionPhotos = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = SectionRequest.safeParse(request.data);
    if (!parsed.success || !PPI_V1.sections.some((s) => s.key === parsed.data.sectionKey)) {
      throw new HttpsError("invalid-argument", "inspectionId and a valid sectionKey are required");
    }
    const { inspectionId, sectionKey } = parsed.data;
    const inspectionRef = await ownedOpenInspection(request.auth.uid, inspectionId);
    await inspectionRef.collection("sections").doc(sectionKey).set({ aiRequested: true }, { merge: true });
    const result = await analyzeSection(request.auth.uid, inspectionRef, sectionKey, new MetaClient({ apiKey: META_API_KEY.value() }));
    return { status: "ok" as const, ...result, cap: MAX_PHOTO_ANALYSES };
  },
);

/**
 * Trigger: a photo finished uploading after its section was submitted for the AI check (taken
 * offline, or still uploading when the inspector moved on). Checks it, within the inspection's cap.
 */
export const onPhotoUploaded = onDocumentUpdated(
  { document: "inspections/{inspectionId}/evidence/{evidenceId}", region: REGION, secrets: [META_API_KEY], memory: "512MiB", timeoutSeconds: 120 },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!before || !after || after.get("kind") !== "photo") return;
    if (before.get("uploadState") === "uploaded" || after.get("uploadState") !== "uploaded") return;

    const db = getFirestore();
    const inspectionRef = db.doc(`inspections/${event.params.inspectionId}`);
    const [inspection, section] = await Promise.all([
      inspectionRef.get(),
      inspectionRef.collection("sections").doc(after.get("sectionKey")).get(),
    ]);
    if (!inspection.exists || inspection.get("status") === "complete" || !section.get("aiRequested")) return;
    if ((await photoAnalysesUsed(inspectionRef.id)) >= MAX_PHOTO_ANALYSES) return;
    await analyzeEvidencePhoto(inspection.get("ownerUid"), inspectionRef, event.params.evidenceId, new MetaClient({ apiKey: META_API_KEY.value() }));
  },
);

/** Hard cap on whole-inspection AI summaries, to bound cost. */
export const MAX_SESSION_ANALYSES = 5;

const InspectionRequest = z.object({ inspectionId: z.string().min(1).max(128) });

/** The inspection and everything under it, in the shape the evidence engine reads. Owner only. */
async function loadInspection(uid: string, inspectionId: string) {
  const ref = getFirestore().doc(`inspections/${inspectionId}`) as DocumentReference;
  const inspection = await ref.get();
  // Same answer for "missing" and "not yours", so ids can't be probed.
  if (!inspection.exists || inspection.get("ownerUid") !== uid) throw new HttpsError("not-found", "Inspection not found");
  if (inspection.get("checklistVersion") !== PPI_V1.version) {
    throw new HttpsError("failed-precondition", "This inspection uses an older checklist");
  }
  const [sections, evidence, findings] = await Promise.all([
    ref.collection("sections").get(),
    ref.collection("evidence").get(),
    ref.collection("findings").get(),
  ]);
  const input: ReviewInput = {
    checklist: PPI_V1,
    sections: Object.fromEntries(sections.docs.map((d) => [d.id, { items: d.get("items") ?? {} }])),
    photos: evidence.docs
      .filter((d) => d.get("kind") === "photo")
      .map((d) => ({ id: d.id, sectionKey: d.get("sectionKey"), itemKey: d.get("itemKey"), uploadState: d.get("uploadState") })),
    obdReads: evidence.docs
      .filter((d) => d.get("kind") === "obd_dtc")
      .map((d) => ({
        id: d.id,
        sectionKey: d.get("sectionKey"),
        itemKey: d.get("itemKey"),
        payload: d.get("payload"),
        capturedAtMs: (d.get("capturedAt") as Timestamp | undefined)?.toMillis(),
      })),
    findings: findings.docs.map((d) => ({
      id: d.id,
      sectionKey: d.get("sectionKey"),
      itemKey: d.get("itemKey"),
      observedCondition: d.get("observedCondition"),
      severity: d.get("severity"),
      verificationStatus: d.get("verificationStatus"),
    })),
  };
  const details = input.sections.vehicle_details?.items as Record<string, ItemRecord> | undefined;
  return { ref, inspection, input, vehicle: sessionVehicle(inspection.get("vehicle"), details) };
}

/**
 * Callable: a plain-language summary and evidence-linked hypotheses for the whole inspection.
 * Built from the rule-based summary, so the model can reword and connect but not add facts.
 * Stored on the inspection as `aiSummary` with the evidence text it was based on.
 */
export const analyzeSession = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = InspectionRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "inspectionId is required");
    const { inspectionId } = parsed.data;
    const uid = request.auth.uid;
    const db = getFirestore();

    const { ref, inspection, input, vehicle } = await loadInspection(uid, inspectionId);
    if (inspection.get("status") === "complete") throw new HttpsError("failed-precondition", "This inspection is complete");

    const used = await db
      .collection("aiUsage")
      .where("inspectionId", "==", inspectionId)
      .where("fn", "==", "analyzeSession")
      .count()
      .get();
    if (used.data().count >= MAX_SESSION_ANALYSES) {
      throw new HttpsError("resource-exhausted", `The AI summary can be generated ${MAX_SESSION_ANALYSES} times per inspection`);
    }

    const { summary } = reviewInspection(input);
    let result;
    try {
      result = await summarizeSession({ vehicle, summary }, new MetaClient({ apiKey: META_API_KEY.value() }));
    } catch {
      throw new HttpsError("unavailable", "AI unavailable");
    }

    const batch = db.batch();
    batch.set(db.collection("aiUsage").doc(), {
      uid,
      inspectionId,
      fn: "analyzeSession",
      usage: result.usage,
      costUsd: totalCost(result.usage),
      createdAt: FieldValue.serverTimestamp(),
    });
    if (result.status === "ok") {
      // updatedAt is left alone: the summary is derived from the inspection, not an edit to it.
      batch.update(ref, {
        aiSummary: {
          ...result.analysis,
          context: result.context,
          model: result.usage.at(-1)?.model ?? null,
          generatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
    await batch.commit();
    if (result.status === "ai_unavailable") return { status: "ai_unavailable" as const };
    return { status: "ok" as const, ...result.analysis };
  },
);

const FinalizeRequest = InspectionRequest.extend({ inspectorName: z.string().trim().min(2).max(80) });

/**
 * Callable: the completion gate, enforced on the server, then sign-off. Writes the report and marks
 * the inspection complete in one transaction; after that, Security Rules lock the inspection.
 * Signing off uses one report, the free one first (PLAN.md §9), in the same transaction.
 */
export const finalizeReport = onCall(
  { region: REGION, enforceAppCheck: true, minInstances: 0, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = FinalizeRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "inspectionId and the inspector's name are required");
    const { inspectionId, inspectorName } = parsed.data;
    const uid = request.auth.uid;
    const db = getFirestore();

    const { ref, inspection, input, vehicle } = await loadInspection(uid, inspectionId);
    if (inspection.get("status") === "complete") throw new HttpsError("failed-precondition", "This inspection is already complete");

    const review = reviewInspection(input);
    if (!review.ready) {
      throw new HttpsError("failed-precondition", `${review.blockers.length} check(s) need attention before sign-off`, {
        blockers: review.blockers.slice(0, 20).map((b) => b.message),
      });
    }

    // Keep the AI summary only if it was generated from exactly this evidence.
    const ai = inspection.get("aiSummary");
    const aiSummary =
      ai && ai.context === sessionContext({ vehicle, summary: review.summary }).text
        ? { overview: ai.overview, hypotheses: ai.hypotheses, model: ai.model ?? null }
        : null;

    const loadedAt = (inspection.get("updatedAt") as Timestamp | undefined)?.toMillis() ?? 0;
    const reportRef = db.collection("reports").doc();
    const creditsRef = db.doc(`credits/${uid}`);
    await db.runTransaction(async (tx) => {
      const [current, credits] = await Promise.all([tx.get(ref), tx.get(creditsRef)]);
      if (current.get("status") === "complete") throw new HttpsError("failed-precondition", "This inspection is already complete");
      // An edit from another device since the review was built would make the report wrong.
      if (((current.get("updatedAt") as Timestamp | undefined)?.toMillis() ?? 0) !== loadedAt) {
        throw new HttpsError("aborted", "The inspection changed while signing off. Try again.");
      }
      const charge = chargeForReport(readBalance(credits.data()));
      if (!charge) {
        throw new HttpsError("failed-precondition", "You have no reports left. Buy a report pack to sign off.", { reason: "no-credits" });
      }
      tx.set(creditsRef, { ...charge.next, updatedAt: FieldValue.serverTimestamp() });
      tx.create(db.collection("creditLedger").doc(), {
        ownerUid: uid,
        delta: charge.source === "paid" ? -1 : 0,
        reason: charge.source === "paid" ? "report" : "free_report",
        reportId: reportRef.id,
        inspectionId,
        createdAt: FieldValue.serverTimestamp(),
      });
      const signOff = { name: inspectorName, uid, at: FieldValue.serverTimestamp() };
      tx.create(reportRef, {
        ownerUid: uid,
        orgId: inspection.get("orgId") ?? null,
        inspectionId,
        checklistVersion: PPI_V1.version,
        vehicle: { ...inspection.get("vehicle"), fuel: vehicle.fuel, odometerKm: vehicle.odometerKm },
        summary: review.summary,
        warnings: review.warnings.filter((w) => w.kind !== "unanswered").map((w) => w.message),
        aiSummary,
        signOff,
        pdfPath: null,
        generatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(ref, {
        status: "complete",
        signOff,
        signedOffAt: FieldValue.serverTimestamp(),
        reportId: reportRef.id,
        verdict: review.summary.verdict,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { status: "ok" as const, reportId: reportRef.id, verdict: review.summary.verdict };
  },
);

const PurchaseRequest = z.object({ productId: z.string().min(1).max(64), purchaseToken: z.string().min(1).max(4096) });

/**
 * Callable: turns a Google Play purchase into reports. The token is checked with Google, granted
 * once (keyed by its hash), then consumed so the pack can be bought again. Safe to call repeatedly
 * for the same purchase, which is how the app recovers one interrupted before it was granted.
 */
export const verifyPurchase = onCall(
  { region: REGION, enforceAppCheck: true, minInstances: 0, timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = PurchaseRequest.safeParse(request.data);
    if (!parsed.success || !findPack(parsed.data.productId)) throw new HttpsError("invalid-argument", "Unknown purchase");
    const { productId, purchaseToken } = parsed.data;
    const uid = request.auth.uid;
    const play = new PlayClient();

    let purchase;
    try {
      purchase = await play.get(productId, purchaseToken);
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 400 || status === 404 || status === 410) throw new HttpsError("not-found", "Google Play doesn't recognise this purchase");
      console.error("[verifyPurchase] Play API", status, e);
      throw new HttpsError("unavailable", "Couldn't reach Google Play. Your purchase is safe; try again in a minute.");
    }

    const db = getFirestore();
    const check = checkPurchase(purchase, uid);
    if (check === "pending") return { status: "pending" as const };
    if (check === "cancelled") throw new HttpsError("failed-precondition", "This purchase was cancelled");
    if (check === "wrong-account") throw new HttpsError("permission-denied", "This purchase belongs to another account");
    if (check === "consumed") {
      // Consumed after we granted it: an app retry after the grant. Anything else wasn't ours.
      const payment = await db.doc(`payments/${paymentId(purchaseToken)}`).get();
      if (payment.get("uid") === uid) return { status: "ok" as const, granted: false, reports: findPack(productId)!.reports };
      throw new HttpsError("failed-precondition", "This purchase has already been used");
    }

    let result;
    try {
      result = await grantPurchase(db, uid, productId, purchaseToken, purchase);
    } catch (e) {
      if (e instanceof Error && e.message === "taken") throw new HttpsError("permission-denied", "This purchase belongs to another account");
      throw e;
    }
    // Granted first, consumed second: a failed consume leaves the token for the app's next retry,
    // which is then idempotent. Play refunds purchases left unconsumed for 3 days.
    try {
      await play.consume(productId, purchaseToken);
    } catch (e) {
      console.error("[verifyPurchase] consume failed", e);
    }
    return { status: "ok" as const, granted: result.status === "granted", reports: result.reports };
  },
);

/** How long a shared report link works. */
export const SHARE_LINK_DAYS = 14;
const SHARE_BASE_URL = "https://torqdrop-connect.web.app/r";

/** Share docs are keyed by the token's hash, so the stored data can't be turned back into a working link. */
const shareDocId = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Callable: a time-limited link to a finished report. Owner only. Anyone with the link can view the
 * report and its photos until it expires, so the app says so before sharing.
 */
export const createReportLink = onCall(
  { region: REGION, enforceAppCheck: true, minInstances: 0, timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = z.object({ reportId: z.string().min(1).max(128) }).safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "reportId is required");
    const db = getFirestore();
    const report = await db.doc(`reports/${parsed.data.reportId}`).get();
    if (!report.exists || report.get("ownerUid") !== request.auth.uid) throw new HttpsError("not-found", "Report not found");

    const token = randomBytes(32).toString("base64url");
    const expiresAt = Timestamp.fromMillis(Date.now() + SHARE_LINK_DAYS * 24 * 3600 * 1000);
    await db.doc(`reportShares/${shareDocId(token)}`).set({
      reportId: report.id,
      inspectionId: report.get("inspectionId"),
      ownerUid: request.auth.uid,
      expiresAt,
      revoked: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { url: `${SHARE_BASE_URL}/${token}`, expiresAt: expiresAt.toMillis() };
  },
);

const NOT_FOUND_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Report unavailable</title><body style="font:16px system-ui;padding:32px;max-width:560px;margin:auto"><h1 style="font-size:22px">This report link has expired or is not valid</h1><p>Ask the person who shared it for a new link.</p></body>`;

/**
 * Public page for a shared report: /r/{token} renders the report, /r/{token}/p/{evidenceId} serves one
 * of its photos. Everything is read from the locked inspection after the token is checked, and photos
 * are streamed through here, so nothing in Storage is ever made public.
 */
export const reportPage = onRequest(
  { region: REGION, invoker: "public", minInstances: 0, timeoutSeconds: 60, memory: "512MiB" },
  async (req, res) => {
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Referrer-Policy", "no-referrer");
    res.set("X-Content-Type-Options", "nosniff");
    const notFound = () => res.status(404).set("Cache-Control", "no-store").type("html").send(NOT_FOUND_PAGE);
    if (req.method !== "GET" && req.method !== "HEAD") return void res.status(405).send("Method not allowed");

    const match = /^\/r\/([A-Za-z0-9_-]{43})(?:\/p\/([A-Za-z0-9]{1,64}))?\/?$/.exec(req.path);
    if (!match) return void notFound();
    const [, token, evidenceId] = match;
    const db = getFirestore();
    const share = await db.doc(`reportShares/${shareDocId(token)}`).get();
    if (!share.exists || share.get("revoked") || (share.get("expiresAt") as Timestamp).toMillis() < Date.now()) {
      return void notFound();
    }
    const report = await db.doc(`reports/${share.get("reportId")}`).get();
    if (!report.exists) return void notFound();
    const ownerUid: string = report.get("ownerUid");
    const inspectionId: string = report.get("inspectionId");
    const inspectionRef = db.doc(`inspections/${inspectionId}`);

    if (evidenceId) {
      const ev = await inspectionRef.collection("evidence").doc(evidenceId).get();
      const path: string | undefined = ev.get("storagePath");
      if (!ev.exists || ev.get("kind") !== "photo" || ev.get("uploadState") !== "uploaded" || !path?.startsWith(`inspection-photos/${ownerUid}/${inspectionId}/`)) {
        return void notFound();
      }
      const file = getStorage().bucket().file(path);
      const [metadata] = await file.getMetadata();
      res.set("Content-Type", metadata.contentType ?? "image/jpeg");
      res.set("Cache-Control", "private, max-age=3600");
      file
        .createReadStream()
        .on("error", () => res.headersSent ? res.end() : notFound())
        .pipe(res);
      return;
    }

    const [inspection, sections, evidence, findings] = await Promise.all([
      inspectionRef.get(),
      inspectionRef.collection("sections").get(),
      inspectionRef.collection("evidence").get(),
      inspectionRef.collection("findings").where("verificationStatus", "==", "confirmed").get(),
    ]);
    if (inspection.get("status") !== "complete") return void notFound();

    const toDate = (t: unknown) => (t instanceof Timestamp ? t.toDate() : null);
    const reads = evidence.docs
      .filter((d) => d.get("kind") === "obd_dtc" && d.get("itemKey") === "ecu_scan")
      .sort((a, b) => ((a.get("capturedAt") as Timestamp)?.toMillis() ?? 0) - ((b.get("capturedAt") as Timestamp)?.toMillis() ?? 0));
    const signOff = report.get("signOff");
    const data: ReportData = {
      reportId: report.id,
      generatedAt: toDate(report.get("generatedAt")),
      signOff: { name: signOff?.name ?? "", at: toDate(signOff?.at) },
      vehicle: report.get("vehicle"),
      checklist: PPI_V1,
      sections: Object.fromEntries(sections.docs.map((d) => [d.id, { items: d.get("items") ?? {} }])),
      summary: report.get("summary"),
      aiSummary: report.get("aiSummary") ?? null,
      findings: findings.docs.map((d) => ({
        id: d.id,
        sectionKey: d.get("sectionKey"),
        itemKey: d.get("itemKey"),
        observedCondition: d.get("observedCondition"),
        severity: d.get("severity"),
        confidence: d.get("confidence") ?? null,
        aiInterpretation: d.get("aiInterpretation") ?? null,
        uncertainty: d.get("uncertainty") ?? null,
      })),
      photos: evidence.docs
        .filter((d) => d.get("kind") === "photo" && d.get("uploadState") === "uploaded")
        .map((d) => ({ id: d.id, sectionKey: d.get("sectionKey"), itemKey: d.get("itemKey") })),
      ecuReadAt: toDate(reads.at(-1)?.get("capturedAt")),
      warnings: report.get("warnings") ?? [],
    };

    const nonce = randomBytes(16).toString("base64");
    res.set(
      "Content-Security-Policy",
      `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    res.set("Cache-Control", "private, no-store");
    res.type("html").send(renderReportHtml(data, { photoUrl: (id) => `/r/${token}/p/${id}`, nonce }));
  },
);

/** Code and symptom explanations per person per day (India date), to bound cost. */
export const MAX_DIAGNOSES_PER_DAY = 20;

/**
 * Takes one unit of a per-user daily AI allowance. `aiQuota/{uid}` holds today's counts; a new day
 * starts from zero. Throws resource-exhausted when the allowance is used up.
 */
async function takeDailyQuota(uid: string, fn: string, limit: number) {
  const db = getFirestore();
  const ref = db.doc(`aiQuota/${uid}`);
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const counts = snap.get("day") === day ? ((snap.get("counts") as Record<string, number>) ?? {}) : {};
    if ((counts[fn] ?? 0) >= limit) {
      throw new HttpsError("resource-exhausted", `You can ask the AI ${limit} times a day. Try again tomorrow.`);
    }
    tx.set(ref, { day, counts: { ...counts, [fn]: (counts[fn] ?? 0) + 1 } });
  });
}

/**
 * Callable: plain-language explanation of trouble codes and symptoms, with possible causes and
 * whether to keep driving. Drive advice is never less cautious than the deterministic safety rules,
 * and the rules' banners are returned with it so the app shows them whatever the model says.
 */
export const explainDtc = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 90 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = DiagnoseRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Give at least one valid trouble code or symptom");
    const req = parsed.data;
    const uid = request.auth.uid;

    await takeDailyQuota(uid, "explainDtc", MAX_DIAGNOSES_PER_DAY);

    let result;
    try {
      result = await explainDiagnostics(req, new MetaClient({ apiKey: META_API_KEY.value() }));
    } catch {
      throw new HttpsError("unavailable", "AI unavailable");
    }

    await getFirestore().collection("aiUsage").add({
      uid,
      fn: "explainDtc",
      usage: result.usage,
      costUsd: totalCost(result.usage),
      createdAt: FieldValue.serverTimestamp(),
    });

    const safety = requestSafety(req);
    if (result.status === "ai_unavailable") return { status: "ai_unavailable" as const, safety };
    return { status: "ok" as const, diagnosis: result.diagnosis, safety, simulated: req.snapshot?.simulated ?? false };
  },
);

/** Document scans per person per day (India date). */
export const MAX_SCANS_PER_DAY = 30;
/** About a 1600 px JPEG; anything bigger wasn't prepared by the app. */
const MAX_SCAN_BYTES = 3 * 1024 * 1024;

const ScanRequest = z.object({ kind: DocumentKind, imageBase64: z.string().min(100).max(Math.ceil((MAX_SCAN_BYTES * 4) / 3)) });

/**
 * Callable: read an RC or insurance policy from a photo and return its fields for the inspector to
 * confirm. The image is sent inline and not stored here; the app files it as evidence separately.
 */
export const scanDocument = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 90, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = ScanRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "A document kind and a JPEG photo are required");
    const image = Buffer.from(parsed.data.imageBase64, "base64");
    // JPEG magic number: the app always sends JPEG.
    if (image.length > MAX_SCAN_BYTES || image[0] !== 0xff || image[1] !== 0xd8) {
      throw new HttpsError("invalid-argument", "The photo must be a JPEG under 3 MB");
    }
    const uid = request.auth.uid;
    await takeDailyQuota(uid, "scanDocument", MAX_SCANS_PER_DAY);

    let result;
    try {
      result = await readDocument(parsed.data.kind, image, new MetaClient({ apiKey: META_API_KEY.value() }));
    } catch {
      throw new HttpsError("unavailable", "AI unavailable");
    }
    await getFirestore().collection("aiUsage").add({
      uid,
      fn: "scanDocument",
      kind: parsed.data.kind,
      usage: result.usage,
      costUsd: totalCost(result.usage),
      createdAt: FieldValue.serverTimestamp(),
    });
    if (result.status === "ai_unavailable") return { status: "ai_unavailable" as const };
    return { status: "ok" as const, scan: result.scan };
  },
);

/** Engine sound checks per person per day (India date). Video costs more than text, so fewer. */
export const MAX_ENGINE_CLIPS_PER_DAY = 10;

/**
 * Callable: listen to (and watch) a short engine clip the app uploaded to
 * `engine-clips/{uid}/{clipId}.mp4`, with any live OBD data from the recording, and return what was
 * heard. The clip is deleted as soon as it has been analysed, whatever the outcome; only the result is
 * kept, on the phone. Drive advice is never less cautious than the fixed safety rules.
 */
export const analyzeEngineClip = onCall(
  { region: REGION, secrets: [META_API_KEY], enforceAppCheck: true, minInstances: 0, timeoutSeconds: 300, memory: "1GiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const parsed = AnalyzeEngineClipRequest.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "A clip and its details are required");
    const { clipId, context } = parsed.data;
    const uid = request.auth.uid;
    const file = getStorage().bucket().file(`engine-clips/${uid}/${clipId}.mp4`);

    try {
      const [meta] = await file.getMetadata().catch(() => [null]);
      if (!meta) throw new HttpsError("not-found", "The clip didn't finish uploading. Try again.");
      if (Number(meta.size) > MAX_CLIP_BYTES) throw new HttpsError("invalid-argument", "The clip is too large");
      await takeDailyQuota(uid, "analyzeEngineClip", MAX_ENGINE_CLIPS_PER_DAY);

      const [video] = await file.download();
      // MP4 starts with a box whose type is "ftyp".
      if (video.subarray(4, 8).toString("latin1") !== "ftyp") throw new HttpsError("invalid-argument", "The clip must be an MP4 video");

      let outcome;
      try {
        outcome = await analyzeEngineSound(video, context, new MetaClient({ apiKey: META_API_KEY.value() }));
      } catch (e) {
        console.error("engine clip analysis failed", e);
        throw new HttpsError("unavailable", "AI unavailable");
      }
      await getFirestore().collection("aiUsage").add({
        uid,
        fn: "analyzeEngineClip",
        durationS: context.durationS,
        bytes: video.length,
        usage: outcome.usage,
        costUsd: totalCost(outcome.usage),
        createdAt: FieldValue.serverTimestamp(),
      });

      const safety = clipSafety(context);
      if (outcome.status === "ai_unavailable") return { status: "ai_unavailable" as const, safety };
      return { status: "ok" as const, result: outcome.result, safety, simulated: context.obd?.simulated ?? false };
    } finally {
      await file.delete().catch(() => {});
    }
  },
);

/**
 * Callable: permanently deletes the caller's account and all their data (Play's account deletion
 * requirement). The app asks the user to type DELETE; the same word is checked here so a stray
 * call can't delete an account.
 */
export const deleteAccount = onCall(
  { region: REGION, enforceAppCheck: true, minInstances: 0, timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
    if (request.data?.confirm !== "DELETE") throw new HttpsError("invalid-argument", "Type DELETE to confirm");
    const uid = request.auth.uid;
    try {
      const deleted = await deleteUserData(uid);
      console.info("Account deleted", { deleted });
      return { status: "ok" as const, deleted };
    } catch (e) {
      console.error("Account deletion failed part-way", e);
      throw new HttpsError("internal", "Some data couldn't be deleted. Try again; nothing already deleted comes back.");
    }
  },
);
