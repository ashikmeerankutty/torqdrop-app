import type { DocumentScan } from "../schemas/document";
import { getSection } from "./checklists/ppi-v1";
import { type ItemRecord, type ItemValue, rateValue } from "./checklists/types";

/** One checklist answer filled from a scanned document, for the inspector to confirm. */
export interface ScannedAnswer {
  sectionKey: string;
  itemKey: string;
  label: string;
  value: ItemValue;
  /** The answer as shown on the confirm screen. */
  display: string;
  record: ItemRecord;
}

/** Shown alongside the answers but not saved as one: things the inspector compares by eye. */
export interface ScannedReference {
  label: string;
  value: string;
  note?: string;
}

function answer(sectionKey: string, itemKey: string, value: ItemValue | null | undefined, today: string): ScannedAnswer | null {
  if (value === null || value === undefined || value === "") return null;
  const def = getSection(sectionKey)?.items.find((i) => i.key === itemKey);
  if (!def) return null;
  const rating = rateValue(def.input, value, today);
  if (!rating) return null;
  const unit = def.input.kind === "number" ? def.input.unit : undefined;
  return {
    sectionKey,
    itemKey,
    label: def.label,
    value,
    display: `${typeof value === "number" ? value.toLocaleString("en-IN") : String(value)}${unit ? ` ${unit}` : ""}`,
    record: { status: rating, label: def.label, value, ...(unit ? { unit } : {}), remarks: "From scanned document" },
  };
}

/**
 * Checklist answers and reference values from a scan. `today` (YYYY-MM-DD) rates expiry dates.
 * Choice answers only use labels the checklist has, so a misread can't create a new option.
 */
export function scanToAnswers(scan: DocumentScan, today: string): { answers: ScannedAnswer[]; references: ScannedReference[] } {
  const answers: (ScannedAnswer | null)[] = [];
  const references: ScannedReference[] = [];

  if (scan.kind === "rc") {
    const f = scan.fields;
    answers.push(
      answer("vehicle_details", "reg_no", f.regNo, today),
      answer("vehicle_details", "make", f.make, today),
      answer("vehicle_details", "model", f.model, today),
      answer("vehicle_details", "variant", f.variant, today),
      answer("vehicle_details", "colour", f.colour, today),
      answer("vehicle_details", "fuel_type", f.fuel, today),
      answer("vehicle_details", "mfg_month_year", f.mfgMonthYear, today),
      answer("documents", "registration_date", f.registrationDate, today),
      answer("documents", "seating_capacity", f.seatingCapacity, today),
      answer("documents", "rto", f.rto, today),
      answer("documents", "owners", f.ownerSerial, today),
      answer("documents", "hypothecation", f.hypothecation === "active" ? "Active" : f.hypothecation === "none" ? "None" : null, today),
    );
    if (f.chassisNumber) {
      references.push({ label: "Chassis number on RC", value: f.chassisNumber, note: "Compare with the number stamped on the car" });
    }
    if (f.engineNumber) {
      references.push({ label: "Engine number on RC", value: f.engineNumber, note: "Compare with the number stamped on the engine" });
    }
  } else {
    const f = scan.fields;
    answers.push(answer("documents", "insurance_type", f.policyType, today), answer("documents", "insurance_expiry", f.expiry, today));
    if (f.insurer) references.push({ label: "Insurer", value: f.insurer });
    if (f.zeroDepreciation != null) references.push({ label: "Zero depreciation", value: f.zeroDepreciation ? "Yes" : "No" });
    if (f.regNo) references.push({ label: "Registration on policy", value: f.regNo });
  }
  return { answers: answers.filter((a): a is ScannedAnswer => !!a), references };
}

/**
 * A warning when the document's registration doesn't match the car's, e.g. a policy for another
 * vehicle. Null when they match or either is missing.
 */
export function registrationMismatch(scan: DocumentScan, carRegNo: string | undefined): string | null {
  const docReg = scan.fields.regNo;
  if (!docReg || !carRegNo) return null;
  const car = carRegNo.replace(/[\s-]/g, "").toUpperCase();
  return docReg === car ? null : `This ${scan.kind === "rc" ? "RC" : "policy"} is for ${docReg}, but the car is ${car}.`;
}
