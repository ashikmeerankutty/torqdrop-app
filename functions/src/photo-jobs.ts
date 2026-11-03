import { type DocumentReference, type DocumentSnapshot, FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { analyzePhoto } from "./analyze-photo";
import type { MetaClient, Usage } from "./shared/meta-client";

/** Hard cap on AI photo analyses per inspection, to bound cost (about $0.007 each). */
export const MAX_PHOTO_ANALYSES = 60;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** A claim older than this is treated as abandoned (the function died mid-analysis). */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** Photos analysed at once within one section. */
const CONCURRENCY = 3;

const totalCost = (usage: Usage[]) => usage.reduce((s, u) => s + u.costUsd, 0);

export type PhotoJobResult =
  | { status: "ok"; imageUsable: boolean; unusableReason: string | null; findingIds: string[] }
  | { status: "ai_unavailable" }
  | { status: "skipped"; reason: "not_uploaded" | "already_done" | "claimed" | "cap" | "bad_path" | "too_large" };

/** Uploaded photos that haven't been analysed yet (or whose analysis failed). */
export function needsAnalysis(ev: DocumentSnapshot): boolean {
  if (ev.get("kind") !== "photo" || ev.get("uploadState") !== "uploaded") return false;
  const status = ev.get("aiAnalysis.status");
  if (!status || status === "ai_unavailable") return true;
  if (status === "running") {
    const started = (ev.get("aiAnalysis.startedAt") as Timestamp | undefined)?.toMillis() ?? 0;
    return Date.now() - started > STALE_CLAIM_MS;
  }
  return false;
}

export async function photoAnalysesUsed(inspectionId: string): Promise<number> {
  const used = await getFirestore()
    .collection("aiUsage")
    .where("inspectionId", "==", inspectionId)
    .where("fn", "==", "analyzePhoto")
    .count()
    .get();
  return used.data().count;
}

/**
 * Marks a photo as being analysed, unless another run already has it. Makes the section call and the
 * upload trigger safe to overlap: each photo is analysed once.
 */
async function claim(ref: DocumentReference): Promise<boolean> {
  return getFirestore().runTransaction(async (tx) => {
    const ev = await tx.get(ref);
    if (!needsAnalysis(ev)) return false;
    tx.update(ref, { aiAnalysis: { status: "running", startedAt: FieldValue.serverTimestamp() } });
    return true;
  });
}

/**
 * Analyse one photo and write its findings as `ai_suggested`, linked to the photo. The caller has
 * already checked ownership and that the inspection isn't complete.
 */
export async function analyzeEvidencePhoto(
  ownerUid: string,
  inspectionRef: DocumentReference,
  evidenceId: string,
  client: MetaClient,
): Promise<PhotoJobResult> {
  const db = getFirestore();
  const inspectionId = inspectionRef.id;
  const evidenceRef = inspectionRef.collection("evidence").doc(evidenceId);
  const evidence = await evidenceRef.get();
  if (!evidence.exists || evidence.get("kind") !== "photo" || evidence.get("uploadState") !== "uploaded") {
    return { status: "skipped", reason: "not_uploaded" };
  }
  if (!needsAnalysis(evidence)) return { status: "skipped", reason: "already_done" };

  const storagePath: string = evidence.get("storagePath");
  // Defence in depth: only the owner's photos for this inspection.
  if (!storagePath?.startsWith(`inspection-photos/${ownerUid}/${inspectionId}/`)) return { status: "skipped", reason: "bad_path" };
  if (!(await claim(evidenceRef))) return { status: "skipped", reason: "claimed" };

  const release = (status: "ai_unavailable") =>
    evidenceRef.update({ aiAnalysis: { status, analyzedAt: FieldValue.serverTimestamp() } });

  const file = getStorage().bucket().file(storagePath);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) > MAX_PHOTO_BYTES) {
    await release("ai_unavailable");
    return { status: "skipped", reason: "too_large" };
  }
  const [image] = await file.download();

  const sectionKey: string = evidence.get("sectionKey");
  const itemKey: string = evidence.get("itemKey");
  let result;
  try {
    result = await analyzePhoto({ sectionKey, itemKey, image, mime: metadata.contentType ?? "image/jpeg" }, client);
  } catch {
    await release("ai_unavailable");
    return { status: "ai_unavailable" };
  }

  const batch = db.batch();
  batch.set(db.collection("aiUsage").doc(), {
    uid: ownerUid,
    inspectionId,
    evidenceId,
    fn: "analyzePhoto",
    usage: result.usage,
    costUsd: totalCost(result.usage),
    createdAt: FieldValue.serverTimestamp(),
  });

  if (result.status === "ai_unavailable") {
    batch.update(evidenceRef, { aiAnalysis: { status: "ai_unavailable", analyzedAt: FieldValue.serverTimestamp() } });
    await batch.commit();
    return { status: "ai_unavailable" };
  }

  const { analysis } = result;
  const findingIds: string[] = [];
  for (const f of analysis.findings) {
    const ref = inspectionRef.collection("findings").doc();
    findingIds.push(ref.id);
    batch.set(ref, {
      sectionKey,
      itemKey,
      ...f,
      verificationStatus: "ai_suggested",
      createdBy: "ai",
      model: result.usage.at(-1)?.model ?? null,
      evidenceLinks: [{ evidenceId, relation: "supports" }],
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(evidenceRef, {
    aiAnalysis: {
      status: "ok",
      imageUsable: analysis.imageUsable,
      ...(analysis.unusableReason ? { unusableReason: analysis.unusableReason } : {}),
      findingIds,
      analyzedAt: FieldValue.serverTimestamp(),
    },
  });
  await batch.commit();
  return { status: "ok", imageUsable: analysis.imageUsable, unusableReason: analysis.unusableReason ?? null, findingIds };
}

/**
 * Analyse every unchecked uploaded photo in a section, up to the inspection's cap, a few at a time.
 * Photos still uploading are picked up by the upload trigger once the section is marked for AI.
 */
export async function analyzeSection(
  ownerUid: string,
  inspectionRef: DocumentReference,
  sectionKey: string,
  client: MetaClient,
): Promise<{ analyzed: number; failed: number; waitingForUpload: number; overCap: number }> {
  const photos = await inspectionRef.collection("evidence").where("sectionKey", "==", sectionKey).where("kind", "==", "photo").get();
  const todo = photos.docs.filter(needsAnalysis);
  const waitingForUpload = photos.docs.filter((d) => d.get("uploadState") !== "uploaded").length;
  const room = Math.max(0, MAX_PHOTO_ANALYSES - (await photoAnalysesUsed(inspectionRef.id)));
  const run = todo.slice(0, room);

  let analyzed = 0;
  let failed = 0;
  for (let i = 0; i < run.length; i += CONCURRENCY) {
    const results = await Promise.all(
      run.slice(i, i + CONCURRENCY).map((d) =>
        analyzeEvidencePhoto(ownerUid, inspectionRef, d.id, client).catch((): PhotoJobResult => ({ status: "ai_unavailable" })),
      ),
    );
    analyzed += results.filter((r) => r.status === "ok").length;
    failed += results.filter((r) => r.status === "ai_unavailable").length;
  }
  return { analyzed, failed, waitingForUpload, overCap: todo.length - run.length };
}
