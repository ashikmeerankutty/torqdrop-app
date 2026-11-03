import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import { PPI_V1 } from "@/lib/diagnostics/checklists/ppi-v1";
import { type Review, reviewInspection } from "@/lib/diagnostics/evidence-engine";
import { sessionContext, sessionVehicle } from "@/lib/diagnostics/session-context";

import {
  type Finding,
  type InspectionSummary,
  type ObdEvidence,
  type PhotoEvidence,
  type SectionDoc,
  subscribeAllEvidence,
  subscribeAllFindings,
  subscribeInspection,
  subscribeSections,
} from "./inspections";

export interface InspectionReview {
  inspection: InspectionSummary;
  review: Review;
  /** True when the stored AI summary was generated from exactly the current evidence. */
  aiSummaryFresh: boolean;
  photos: PhotoEvidence[];
}

/**
 * Live review of an inspection: the same evidence engine finalizeReport runs, over everything the
 * phone has. Null while loading. Subscribed while focused.
 */
export function useInspectionReview(id: string): InspectionReview | null {
  const [inspection, setInspection] = useState<InspectionSummary | null>(null);
  const [sections, setSections] = useState<Record<string, SectionDoc> | null>(null);
  const [evidence, setEvidence] = useState<{ photos: PhotoEvidence[]; obd: ObdEvidence[] } | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  useFocusEffect(useCallback(() => subscribeInspection(id, setInspection), [id]));
  useFocusEffect(useCallback(() => subscribeSections(id, setSections), [id]));
  useFocusEffect(useCallback(() => subscribeAllEvidence(id, setEvidence), [id]));
  useFocusEffect(useCallback(() => subscribeAllFindings(id, setFindings), [id]));

  return useMemo(() => {
    if (!inspection || !sections || !evidence || !findings) return null;
    const review = reviewInspection({
      checklist: PPI_V1,
      sections,
      photos: evidence.photos,
      // A read still waiting for its server timestamp is the one just taken, so it's the newest.
      obdReads: evidence.obd.map((r) => ({ ...r, capturedAtMs: r.capturedAt?.getTime() ?? Number.MAX_SAFE_INTEGER })),
      findings,
    });
    const vehicle = sessionVehicle(inspection.vehicle, sections.vehicle_details?.items);
    const aiSummaryFresh =
      !!inspection.aiSummary && inspection.aiSummary.context === sessionContext({ vehicle, summary: review.summary }).text;
    return { inspection, review, aiSummaryFresh, photos: evidence.photos };
  }, [inspection, sections, evidence, findings]);
}
