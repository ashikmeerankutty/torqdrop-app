import { describe, expect, it } from "vitest";
import { PPI_V1 } from "../lib/diagnostics/checklists/ppi-v1";
import {
  type ItemRecord,
  rateValue,
  sectionProgress,
  treadPercent,
  treadRating,
} from "../lib/diagnostics/checklists/types";

const TODAY = "2026-10-27";

describe("ppi-v1 template", () => {
  it("has the 14 sections from docs/checklist-ppi-v1.md", () => {
    expect(PPI_V1.sections).toHaveLength(14);
  });

  it("has unique section keys and unique item keys", () => {
    const sectionKeys = PPI_V1.sections.map((s) => s.key);
    expect(new Set(sectionKeys).size).toBe(sectionKeys.length);
    const itemKeys = PPI_V1.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(itemKeys).size).toBe(itemKeys.length);
  });

  it("marks the completion-gate items as critical", () => {
    const critical = new Set(PPI_V1.sections.flatMap((s) => s.items.filter((i) => i.critical).map((i) => i.key)));
    for (const key of ["rc", "chassis_no", "engine_no", "compression_leak", "brake_fl", "underbody", "tyre_fr", "ecu_scan", "floor_panel"]) {
      expect(critical, key).toContain(key);
    }
  });

  it("gives every choice item at least two options with unique labels", () => {
    for (const s of PPI_V1.sections) {
      for (const i of s.items) {
        if (i.input.kind !== "choice") continue;
        const labels = i.input.options.map((o) => o.label);
        expect(labels.length, i.key).toBeGreaterThanOrEqual(2);
        expect(new Set(labels).size, i.key).toBe(labels.length);
      }
    }
  });
});

describe("rateValue", () => {
  it("maps a choice label to its rating and rejects unknown labels", () => {
    const input = { kind: "choice" as const, options: [{ label: "Repainted", rating: "attention" as const }] };
    expect(rateValue(input, "Repainted", TODAY)).toBe("attention");
    expect(rateValue(input, "Shiny", TODAY)).toBeNull();
  });

  it("rates a panel by the worse of paint and structure, and needs both", () => {
    const panel = { kind: "panel" as const };
    expect(rateValue(panel, { paint: "Original", structure: "Good" }, TODAY)).toBe("good");
    expect(rateValue(panel, { paint: "Repainted", structure: "Good" }, TODAY)).toBe("attention");
    expect(rateValue(panel, { paint: "Original", structure: "Replaced" }, TODAY)).toBe("defect");
    expect(rateValue(panel, { paint: "Original" }, TODAY)).toBeNull();
  });

  it("rates an expired insurance date as attention", () => {
    const expiry = { kind: "date" as const, expiry: true };
    expect(rateValue(expiry, "2026-01-01", TODAY)).toBe("attention");
    expect(rateValue(expiry, "2027-01-01", TODAY)).toBe("good");
    expect(rateValue(expiry, "01/01/2027", TODAY)).toBeNull();
  });

  it("rejects empty text and negative numbers", () => {
    expect(rateValue({ kind: "text" }, "  ", TODAY)).toBeNull();
    expect(rateValue({ kind: "number" }, -1, TODAY)).toBeNull();
    expect(rateValue({ kind: "number" }, 42000, TODAY)).toBe("good");
  });
});

describe("tread", () => {
  it("rates against the 1.6 mm legal minimum", () => {
    expect(treadRating(1.5)).toBe("defect");
    expect(treadRating(2.5)).toBe("attention");
    expect(treadRating(3.5)).toBe("acceptable");
    expect(treadRating(6)).toBe("good");
  });

  it("reports usable tread as a clamped percentage", () => {
    expect(treadPercent(8)).toBe(100);
    expect(treadPercent(1.6)).toBe(0);
    expect(treadPercent(4.8)).toBe(50);
    expect(treadPercent(10)).toBe(100);
  });
});

describe("sectionProgress", () => {
  const brakes = PPI_V1.sections.find((s) => s.key === "brakes")!;
  const all = (status: ItemRecord["status"]) =>
    Object.fromEntries(brakes.items.map((i) => [i.key, { status, label: i.label }]));

  it("is not started until every item is answered, and lists open critical items", () => {
    const p = sectionProgress(brakes, { brake_fr: { status: "good", label: "x" } });
    expect(p).toMatchObject({ answered: 1, total: 7, status: "not_started" });
    expect(p.openCritical).not.toContain("brake_fr");
    expect(p.openCritical).toContain("hand_brake");
  });

  it("needs investigation when any item is attention or defect", () => {
    expect(sectionProgress(brakes, { ...all("good"), side_pull: { status: "attention", label: "x" } }).status).toBe(
      "needs_investigation",
    );
  });

  it("is complete when all are answered and none are flagged", () => {
    expect(sectionProgress(brakes, { ...all("good"), hand_brake: { status: "not_applicable", label: "x" } }).status).toBe(
      "complete",
    );
  });

  it("is not inspected when every item is not inspected", () => {
    expect(sectionProgress(brakes, all("not_inspected")).status).toBe("not_inspected");
  });
});
