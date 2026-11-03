import type { ItemRecord } from "./checklists/types";
import { describeDtc } from "./dtc-database";
import type { InspectionSummaryReport } from "./evidence-engine";

/**
 * The evidence text the session summary is generated from. Shared so the app can tell whether a
 * stored AI summary still matches the inspection: same text, same evidence.
 */

export interface SessionInput {
  vehicle: { make: string; model: string; variant?: string | null; year?: number | null; fuel?: string | null; odometerKm?: number | null };
  summary: InspectionSummaryReport;
}

/** Evidence as tagged lines, and the set of refs the model may cite. No registration numbers or photos. */
export function sessionContext({ vehicle: v, summary }: SessionInput): { text: string; refs: Set<string> } {
  const refs = new Set<string>();
  const lines: string[] = [];
  const car = [v.year, v.make, v.model, v.variant, v.fuel, v.odometerKm != null ? `${v.odometerKm} km` : null].filter(Boolean).join(" ");
  lines.push(`Vehicle: ${car}`);
  lines.push(
    `Checks: ${summary.counts.answered} of ${summary.counts.total} answered; ${summary.counts.defect} defect, ${summary.counts.attention} attention, ${summary.counts.notInspected} not inspected.`,
  );

  lines.push("", "Flagged checks:");
  if (!summary.flagged.length) lines.push("- none");
  for (const f of summary.flagged) {
    const ref = `${f.sectionKey}/${f.itemKey}`;
    refs.add(ref);
    lines.push(
      `- [${ref}] ${f.sectionTitle} › ${f.label}: ${f.status.toUpperCase()}${f.value ? ` (${f.value})` : ""}${f.remarks ? `; inspector remark: ${f.remarks}` : ""}`,
    );
    for (const c of f.findings) lines.push(`  - confirmed photo finding (${c.severity}): ${c.observedCondition}`);
  }

  lines.push("", "OBD trouble codes:");
  const ecu = summary.ecu;
  if (!ecu) lines.push("- not read");
  else {
    const codes = [...ecu.stored.map((c) => ({ c, kind: "stored" })), ...ecu.pending.map((c) => ({ c, kind: "pending" }))];
    if (!codes.length) lines.push("- none");
    for (const { c, kind } of codes) {
      refs.add(c);
      lines.push(`- [${c}] ${kind}: ${describeDtc(c).title}`);
    }
    lines.push(`- check-engine light: ${ecu.milOn == null ? "unknown" : ecu.milOn ? "on" : "off"}${ecu.simulated ? " (SIMULATED data)" : ""}`);
  }

  lines.push("", "Not inspected:");
  if (!summary.notInspected.length) lines.push("- none");
  for (const n of summary.notInspected) lines.push(`- ${n.sectionTitle} › ${n.label}${n.reason ? `: ${n.reason}` : ""}`);
  if (summary.counts.unanswered) lines.push(`- ${summary.counts.unanswered} other checks were not answered`);

  return { text: lines.join("\n"), refs };
}

/** Vehicle facts for the summary: the inspection's vehicle plus fuel and odometer from Vehicle details. */
export function sessionVehicle(
  vehicle: { make: string; model: string; variant?: string | null; year?: number | null },
  details: Record<string, ItemRecord> | undefined,
): SessionInput["vehicle"] {
  const fuel = details?.fuel_type?.value;
  const odometer = details?.odometer?.value;
  return {
    make: vehicle.make,
    model: vehicle.model,
    variant: vehicle.variant ?? null,
    year: vehicle.year ?? null,
    fuel: typeof fuel === "string" ? fuel : null,
    odometerKm: typeof odometer === "number" ? odometer : null,
  };
}
