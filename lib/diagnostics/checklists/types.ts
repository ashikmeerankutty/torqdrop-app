/** The one status scale every check maps onto. Drives chip colours, the summary and the safety rules. */
export type Rating = "good" | "acceptable" | "attention" | "defect";
export type ItemStatus = Rating | "not_applicable" | "not_inspected";
export type SectionStatus = "not_started" | "complete" | "needs_investigation" | "not_inspected";

export interface ChoiceOption {
  /** Familiar label shown to the user, e.g. "Repainted". */
  label: string;
  rating: Rating;
}

export type ItemInput =
  | { kind: "choice"; options: ChoiceOption[] }
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; unit?: string }
  /** `YYYY-MM-DD`. With `expiry`, a past date rates as attention. */
  | { kind: "date"; expiry?: boolean }
  /** Tyre tread depth in mm. */
  | { kind: "tread" }
  /** Body panel: paint and structure are rated separately; the item takes the worse of the two. */
  | { kind: "panel" };

export interface ItemDef {
  key: string;
  label: string;
  input: ItemInput;
  /** Blocks completion while not answered. */
  critical?: boolean;
  photo?: boolean;
  ai?: boolean;
  obd?: boolean;
}

export interface SectionDef {
  key: string;
  title: string;
  critical?: boolean;
  items: ItemDef[];
}

export interface Checklist {
  version: string;
  sections: SectionDef[];
}

export interface PanelValue {
  paint?: string;
  structure?: string;
}

export type ItemValue = string | number | PanelValue;

/** Stored at `inspections/{id}/sections/{key}.items.{itemKey}`. */
export interface ItemRecord {
  status: ItemStatus;
  label: string;
  value?: ItemValue;
  unit?: string;
  remarks?: string;
  notInspectedReason?: string;
  evidenceIds?: string[];
}

export const PAINT_OPTIONS: ChoiceOption[] = [
  { label: "Original", rating: "good" },
  { label: "Scratched", rating: "attention" },
  { label: "Dented", rating: "attention" },
  { label: "Repainted", rating: "attention" },
];

export const STRUCTURE_OPTIONS: ChoiceOption[] = [
  { label: "Good", rating: "good" },
  { label: "Repaired", rating: "attention" },
  { label: "Replaced", rating: "defect" },
];

/** New tyres have about 8 mm of tread; 1.6 mm is the legal minimum. */
export const TREAD_NEW_MM = 8;
export const TREAD_MIN_MM = 1.6;

const RANK: Record<Rating, number> = { good: 0, acceptable: 1, attention: 2, defect: 3 };

export function worst(ratings: Rating[]): Rating {
  return ratings.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "good");
}

export function treadRating(mm: number): Rating {
  if (mm < TREAD_MIN_MM) return "defect";
  if (mm < 3) return "attention";
  if (mm < 4) return "acceptable";
  return "good";
}

/** Share of usable tread left, 0–100. */
export function treadPercent(mm: number): number {
  const pct = ((mm - TREAD_MIN_MM) / (TREAD_NEW_MM - TREAD_MIN_MM)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

/**
 * Rating for an answered value, or null if the value is incomplete or invalid.
 * Text, number and plain date items are records, not judgements, so a value rates as good.
 */
export function rateValue(input: ItemInput, value: ItemValue, today: string): Rating | null {
  switch (input.kind) {
    case "choice":
      return input.options.find((o) => o.label === value)?.rating ?? null;
    case "text":
      return typeof value === "string" && value.trim() ? "good" : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? "good" : null;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      return input.expiry && value < today ? "attention" : "good";
    case "tread":
      return typeof value === "number" && value >= 0 && value <= 20 ? treadRating(value) : null;
    case "panel": {
      if (typeof value !== "object") return null;
      const paint = PAINT_OPTIONS.find((o) => o.label === value.paint);
      const structure = STRUCTURE_OPTIONS.find((o) => o.label === value.structure);
      return paint && structure ? worst([paint.rating, structure.rating]) : null;
    }
  }
}

export interface SectionProgress {
  answered: number;
  total: number;
  status: SectionStatus;
  /** Critical items still unanswered. */
  openCritical: string[];
}

export function sectionProgress(section: SectionDef, items: Record<string, ItemRecord | undefined>): SectionProgress {
  const records = section.items.map((i) => items[i.key]);
  const answered = records.filter((r) => r?.status).length;
  const openCritical = section.items.filter((i) => i.critical && !items[i.key]?.status).map((i) => i.key);

  let status: SectionStatus = "not_started";
  if (answered === section.items.length) {
    if (records.some((r) => r!.status === "attention" || r!.status === "defect")) status = "needs_investigation";
    else if (records.every((r) => r!.status === "not_inspected")) status = "not_inspected";
    else status = "complete";
  }
  return { answered, total: section.items.length, status, openCritical };
}
