import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getFirestore,
  increment,
  onSnapshot,
  orderBy,
  type Query,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "@react-native-firebase/firestore";

import { PPI_V1 } from "@/lib/diagnostics/checklists/ppi-v1";
import { type ItemRecord, sectionProgress, type SectionStatus } from "@/lib/diagnostics/checklists/types";
import type { EcuExtended, Verdict } from "@/lib/diagnostics/evidence-engine";
import type { SessionAnalysis } from "@/lib/schemas/session";

// Writes are never awaited by the UI: Firestore applies them to the local cache at once and syncs
// when online, so an inspection works in a basement with no signal. Awaiting would block until the
// server acknowledges.

export const PPI_TOTAL = PPI_V1.sections.reduce((n, s) => n + s.items.length, 0);

export type InspectionStatus = "draft" | "in_progress" | "blocked" | "complete";

export interface VehicleInput {
  regNo: string;
  make: string;
  model: string;
  variant?: string;
  year?: number;
  fuel: string;
  transmission: string;
  odometerKm: number;
}

export interface InspectionSummary {
  id: string;
  vehicle: { regNo: string; make: string; model: string; variant?: string; year?: number };
  status: InspectionStatus;
  checklistVersion: string;
  /** Answered checks across all sections. Missing on inspections created before it was added. */
  progress?: { answered: number; total: number };
  updatedAt?: Date;
  /** Set by the analyzeSession function. `context` is the evidence text it was generated from. */
  aiSummary?: SessionAnalysis & { context: string; generatedAt?: Date };
  /** Set by finalizeReport. */
  signOff?: { name: string; at?: Date };
  reportId?: string;
  verdict?: Verdict;
}

export interface SectionDoc {
  status: SectionStatus;
  answered: number;
  total: number;
  items: Record<string, ItemRecord>;
}

export interface PhotoEvidence {
  id: string;
  sectionKey: string;
  itemKey: string;
  storagePath: string;
  uploadState: "pending" | "uploaded";
  capturedAt?: Date;
  /** Set by the photo AI check; "running" while a function is analysing it. */
  aiAnalysis?: {
    status: "ok" | "ai_unavailable" | "running";
    imageUsable?: boolean;
    unusableReason?: string;
    findingIds?: string[];
  };
}

export type VerificationStatus = "ai_suggested" | "awaiting_verification" | "confirmed" | "dismissed";

export interface Finding {
  id: string;
  sectionKey: string;
  itemKey: string;
  observedCondition: string;
  severity: "info" | "monitor" | "attention" | "urgent";
  confidence?: "low" | "medium" | "high";
  aiInterpretation?: string;
  uncertainty?: string;
  missingEvidence?: string[];
  nextAction?: string;
  verificationStatus: VerificationStatus;
  createdBy: "ai" | "inspector" | "rule";
  evidenceLinks: { evidenceId: string; relation: "supports" | "contradicts" }[];
  createdAt?: Date;
}

export interface ObdEvidence {
  id: string;
  sectionKey: string;
  itemKey: string;
  payload: {
    stored: string[];
    pending: string[];
    milOn: boolean | null;
    protocol: string | null;
    simulated: boolean;
    extended?: EcuExtended | null;
  };
  capturedAt?: Date;
}

const db = () => getFirestore();
const inspectionRef = (id: string) => doc(db(), "inspections", id);
const sectionRef = (inspectionId: string, key: string) => doc(db(), "inspections", inspectionId, "sections", key);

/**
 * Creates the vehicle and a draft PPI inspection in one batch, and pre-fills
 * the Vehicle details section from the form. Returns the inspection id.
 */
export function createInspection(
  ownerUid: string,
  v: VehicleInput,
  /** More answers to save with it, e.g. from a scanned RC: section key → item key → record. */
  extra: Record<string, Record<string, ItemRecord>> = {},
): string {
  const vehicleRef = doc(collection(db(), "vehicles"));
  const ref = doc(collection(db(), "inspections"));
  const vehicle = { regNo: v.regNo, make: v.make, model: v.model, variant: v.variant ?? null, year: v.year ?? null };
  const now = serverTimestamp();

  const batch = writeBatch(db());
  batch.set(vehicleRef, {
    ownerUid,
    vin: null,
    ...vehicle,
    fuel: v.fuel,
    transmission: v.transmission,
    odometerKm: v.odometerKm,
    createdAt: now,
    updatedAt: now,
  });
  const details = PPI_V1.sections[0];
  const prefill: Record<string, string | number | undefined> = {
    reg_no: v.regNo,
    make: v.make,
    model: v.model,
    variant: v.variant,
    fuel_type: v.fuel,
    transmission: v.transmission,
    odometer: v.odometerKm,
  };
  const items: Record<string, ItemRecord> = {};
  for (const def of details.items) {
    const value = prefill[def.key];
    if (value === undefined || value === "") continue;
    items[def.key] = { status: "good", label: def.label, value, ...(def.key === "odometer" ? { unit: "km" } : {}) };
  }
  // Scanned answers fill gaps only; what the inspector typed in the form wins.
  for (const [key, record] of Object.entries(extra[details.key] ?? {})) items[key] ??= record;
  const progress = sectionProgress(details, items);
  const others = Object.entries(extra)
    .filter(([key]) => key !== details.key)
    .map(([key, sectionItems]) => ({ section: PPI_V1.sections.find((s) => s.key === key), items: sectionItems }))
    .filter((x): x is { section: (typeof PPI_V1.sections)[number]; items: Record<string, ItemRecord> } => !!x.section);
  const answered = progress.answered + others.reduce((n, o) => n + sectionProgress(o.section, o.items).answered, 0);
  batch.set(ref, {
    ownerUid,
    vehicleId: vehicleRef.id,
    vehicle,
    mode: "ppi",
    status: "draft",
    checklistVersion: PPI_V1.version,
    inspectorUid: ownerUid,
    progress: { answered, total: PPI_TOTAL },
    createdAt: now,
    updatedAt: now,
  });
  batch.set(sectionRef(ref.id, details.key), {
    status: progress.status,
    answered: progress.answered,
    total: progress.total,
    items,
    updatedAt: now,
  });

  for (const o of others) {
    const p = sectionProgress(o.section, o.items);
    batch.set(sectionRef(ref.id, o.section.key), {
      status: p.status,
      answered: p.answered,
      total: p.total,
      items: o.items,
      updatedAt: now,
    });
  }

  batch.commit().catch((e) => console.warn("[inspections] create failed", e));
  return ref.id;
}

function toSummary(id: string, data: Record<string, any>): InspectionSummary {
  const date = (v: any): Date | undefined => v?.toDate?.();
  return {
    id,
    ...data,
    updatedAt: date(data.updatedAt),
    ...(data.aiSummary ? { aiSummary: { ...data.aiSummary, generatedAt: date(data.aiSummary.generatedAt) } } : {}),
    ...(data.signOff ? { signOff: { ...data.signOff, at: date(data.signOff.at) } } : {}),
  } as InspectionSummary;
}

export function subscribeInspections(ownerUid: string, onChange: (list: InspectionSummary[]) => void) {
  const q = query(collection(db(), "inspections"), where("ownerUid", "==", ownerUid), orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => {
          const data = d.data();
          return toSummary(d.id, data);
        }),
      ),
    (e) => console.warn("[inspections] list failed", e),
  );
}

export function subscribeInspection(id: string, onChange: (inspection: InspectionSummary | null) => void) {
  return onSnapshot(
    inspectionRef(id),
    (snap) => {
      const data = snap.data();
      onChange(data ? (toSummary(snap.id, data)) : null);
    },
    (e) => console.warn("[inspections] read failed", e),
  );
}

export function subscribeSections(inspectionId: string, onChange: (sections: Record<string, SectionDoc>) => void) {
  return onSnapshot(
    collection(db(), "inspections", inspectionId, "sections"),
    (snap) => onChange(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as SectionDoc]))),
    (e) => console.warn("[inspections] sections failed", e),
  );
}

/** All evidence for a section, split into photos and OBD code reads. */
export function subscribeSectionEvidence(
  inspectionId: string,
  sectionKey: string,
  onChange: (evidence: { photos: PhotoEvidence[]; obd: ObdEvidence[] }) => void,
) {
  const q = query(collection(db(), "inspections", inspectionId, "evidence"), where("sectionKey", "==", sectionKey));
  return subscribeEvidenceQuery(q, onChange);
}

/** All evidence in the inspection, for the review. */
export function subscribeAllEvidence(
  inspectionId: string,
  onChange: (evidence: { photos: PhotoEvidence[]; obd: ObdEvidence[] }) => void,
) {
  return subscribeEvidenceQuery(collection(db(), "inspections", inspectionId, "evidence"), onChange);
}

function subscribeEvidenceQuery(
  q: Query,
  onChange: (evidence: { photos: PhotoEvidence[]; obd: ObdEvidence[] }) => void,
) {
  return onSnapshot(
    q,
    (snap) => {
      const photos: PhotoEvidence[] = [];
      const obd: ObdEvidence[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        const item = { id: d.id, ...data, capturedAt: data.capturedAt?.toDate?.() };
        if (data.kind === "photo") photos.push(item as PhotoEvidence);
        else if (data.kind === "obd_dtc") obd.push(item as ObdEvidence);
      }
      onChange({ photos, obd });
    },
    (e) => console.warn("[inspections] evidence failed", e),
  );
}

/**
 * Saves one item and the section's recomputed progress. `record` replaces the item's answer;
 * evidenceIds are left alone. `currentItems` is the section as last seen, used for progress.
 */
export function saveItem(
  inspectionId: string,
  sectionKey: string,
  itemKey: string,
  record: Omit<ItemRecord, "evidenceIds">,
  currentItems: Record<string, ItemRecord>,
  inspectionStatus: InspectionStatus,
) {
  saveItems(inspectionId, sectionKey, { [itemKey]: record }, currentItems, inspectionStatus);
}

/** Saves several items of one section in one batch, e.g. answers filled from a scanned document. */
export function saveItems(
  inspectionId: string,
  sectionKey: string,
  records: Record<string, Omit<ItemRecord, "evidenceIds">>,
  currentItems: Record<string, ItemRecord>,
  inspectionStatus: InspectionStatus,
) {
  const section = PPI_V1.sections.find((s) => s.key === sectionKey);
  if (!section) throw new Error(`Unknown section ${sectionKey}`);
  const progress = sectionProgress(section, { ...currentItems, ...records });
  const answeredDelta = progress.answered - sectionProgress(section, currentItems).answered;
  const now = serverTimestamp();

  const items: Record<string, object> = {};
  for (const [itemKey, record] of Object.entries(records)) {
    items[itemKey] = {
      status: record.status,
      label: record.label,
      value: record.value ?? deleteField(),
      unit: record.unit ?? deleteField(),
      remarks: record.remarks ?? deleteField(),
      notInspectedReason: record.notInspectedReason ?? deleteField(),
    };
  }

  const batch = writeBatch(db());
  batch.set(
    sectionRef(inspectionId, sectionKey),
    { status: progress.status, answered: progress.answered, total: progress.total, items, updatedAt: now },
    { merge: true },
  );
  batch.update(inspectionRef(inspectionId), {
    updatedAt: now,
    // An increment, so two sections saved offline both count.
    ...(answeredDelta ? { "progress.answered": increment(answeredDelta), "progress.total": PPI_TOTAL } : {}),
    ...(inspectionStatus === "draft" ? { status: "in_progress" } : {}),
  });
  batch.commit().catch((e) => console.warn("[inspections] save failed", e));
}

/** Corrects the inspection's progress counter from the real answers, e.g. on inspections made before it existed. */
export function syncProgress(inspectionId: string, answered: number, total: number) {
  updateDoc(inspectionRef(inspectionId), { progress: { answered, total } }).catch((e) =>
    console.warn("[inspections] progress sync failed", e),
  );
}

/** Records a photo as evidence for an item. The file itself is uploaded later by the upload queue. */
export function addPhotoEvidence(
  ownerUid: string,
  inspectionId: string,
  sectionKey: string,
  itemKey: string,
  size: { width: number; height: number },
): { evidenceId: string; storagePath: string } {
  const ref = doc(collection(db(), "inspections", inspectionId, "evidence"));
  const storagePath = `inspection-photos/${ownerUid}/${inspectionId}/${ref.id}.jpg`;
  const now = serverTimestamp();

  const batch = writeBatch(db());
  batch.set(ref, {
    sectionKey,
    itemKey,
    kind: "photo",
    payload: size,
    storagePath,
    uploadState: "pending",
    source: "measured",
    capturedAt: now,
  });
  batch.set(sectionRef(inspectionId, sectionKey), { items: { [itemKey]: { evidenceIds: arrayUnion(ref.id) } } }, { merge: true });
  batch.update(inspectionRef(inspectionId), { updatedAt: now });
  batch.commit().catch((e) => console.warn("[inspections] photo evidence failed", e));
  return { evidenceId: ref.id, storagePath };
}

export function markPhotoUploaded(inspectionId: string, evidenceId: string) {
  return updateDoc(doc(db(), "inspections", inspectionId, "evidence", evidenceId), {
    uploadState: "uploaded",
    uploadedAt: serverTimestamp(),
  });
}

/** Records a trouble-code read from the car as measured evidence for an item. */
export function addObdEvidence(
  inspectionId: string,
  sectionKey: string,
  itemKey: string,
  payload: ObdEvidence["payload"],
): string {
  const ref = doc(collection(db(), "inspections", inspectionId, "evidence"));
  const now = serverTimestamp();
  const batch = writeBatch(db());
  batch.set(ref, { sectionKey, itemKey, kind: "obd_dtc", payload, source: "measured", capturedAt: now });
  batch.set(sectionRef(inspectionId, sectionKey), { items: { [itemKey]: { evidenceIds: arrayUnion(ref.id) } } }, { merge: true });
  batch.commit().catch((e) => console.warn("[inspections] OBD evidence failed", e));
  return ref.id;
}

export function subscribeSectionFindings(inspectionId: string, sectionKey: string, onChange: (findings: Finding[]) => void) {
  const q = query(collection(db(), "inspections", inspectionId, "findings"), where("sectionKey", "==", sectionKey));
  return subscribeFindingsQuery(q, onChange);
}

/** All findings in the inspection, for the review. */
export function subscribeAllFindings(inspectionId: string, onChange: (findings: Finding[]) => void) {
  return subscribeFindingsQuery(collection(db(), "inspections", inspectionId, "findings"), onChange);
}

function subscribeFindingsQuery(q: Query, onChange: (findings: Finding[]) => void) {
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, createdAt: data.createdAt?.toDate?.() } as Finding;
        }),
      ),
    (e) => console.warn("[inspections] findings failed", e),
  );
}

/** An inspector confirms or dismisses an AI suggestion. The item's own answer is never changed by this. */
export function setFindingVerification(inspectionId: string, findingId: string, status: "confirmed" | "dismissed") {
  updateDoc(doc(db(), "inspections", inspectionId, "findings", findingId), {
    verificationStatus: status,
    verifiedAt: serverTimestamp(),
  }).catch((e) => console.warn("[inspections] verify failed", e));
}
