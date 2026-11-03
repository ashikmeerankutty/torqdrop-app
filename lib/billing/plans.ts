/**
 * Report packs sold through Google Play as one-time, consumable products. The IDs must match the
 * products set up in Play Console. Prices here are fallbacks for display only: the app shows Play's
 * own price, and the server grants reports by product ID. A report is used when an inspection is
 * signed off (PLAN.md §9). Shared by the app and Cloud Functions.
 */

export interface ReportPack {
  id: string;
  name: string;
  reports: number;
  /** Rupees, GST included. Fallback only: Play's price is shown when available. */
  price: number;
  tagline: string;
  highlighted?: boolean;
}

export const REPORT_PACKS: ReportPack[] = [
  { id: "report_1", name: "Single report", reports: 1, price: 199, tagline: "Checking one car before you buy" },
  { id: "report_5", name: "5 reports", reports: 5, price: 799, tagline: "Comparing a shortlist", highlighted: true },
  { id: "report_20", name: "20 reports", reports: 20, price: 2499, tagline: "Freelance inspectors" },
];

/** Signed-off reports every new account gets before it needs a pack. */
export const FREE_REPORTS = 1;

export function findPack(id: string): ReportPack | undefined {
  return REPORT_PACKS.find((p) => p.id === id);
}

/** What the account has left. Stored in `credits/{uid}`, written only by Cloud Functions. */
export interface CreditBalance {
  /** Paid reports not yet used. */
  balance: number;
  /** Free reports already used. */
  freeUsed: number;
}

/** Reports the account can still sign off. */
export const reportsLeft = (c: CreditBalance) => c.balance + Math.max(0, FREE_REPORTS - c.freeUsed);

/** ₹2,499 — Indian digit grouping. */
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
