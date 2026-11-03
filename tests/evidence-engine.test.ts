import { describe, expect, it } from "vitest";
import type { Checklist, ItemInput, ItemRecord } from "../lib/diagnostics/checklists/types";
import { PPI_V1 } from "../lib/diagnostics/checklists/ppi-v1";
import { formatValue, type ReviewInput, reviewInspection } from "../lib/diagnostics/evidence-engine";

const OK: ItemInput = { kind: "choice", options: [{ label: "OK", rating: "good" }, { label: "Bad", rating: "defect" }] };
const ECU: ItemInput = {
  kind: "choice",
  options: [
    { label: "No codes", rating: "good" },
    { label: "Pending codes", rating: "attention" },
    { label: "Stored codes", rating: "defect" },
  ],
};

const checklist: Checklist = {
  version: "test",
  sections: [
    {
      key: "engine",
      title: "Engine",
      critical: true,
      items: [
        { key: "leakage", label: "Leakage", input: OK, critical: true, photo: true },
        { key: "noise", label: "Noise", input: OK },
      ],
    },
    {
      key: "electricals",
      title: "Electricals",
      items: [
        { key: "ecu_scan", label: "ECU scan", input: ECU, critical: true },
        { key: "warning_lamps", label: "Warning lamps", input: { kind: "choice", options: [{ label: "None lit", rating: "good" }, { label: "Lamp lit", rating: "attention" }] } },
      ],
    },
  ],
};

const rec = (status: ItemRecord["status"], value?: string, extra: Partial<ItemRecord> = {}): ItemRecord => ({
  status,
  label: "x",
  ...(value ? { value } : {}),
  ...extra,
});

function input(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    checklist,
    sections: {
      engine: { items: { leakage: rec("good", "OK"), noise: rec("good", "OK") } },
      electricals: { items: { ecu_scan: rec("good", "No codes"), warning_lamps: rec("good", "None lit") } },
    },
    photos: [{ id: "p1", sectionKey: "engine", itemKey: "leakage", uploadState: "uploaded" }],
    obdReads: [],
    findings: [],
    ...over,
  };
}

const kinds = (issues: { kind: string }[]) => issues.map((i) => i.kind);

describe("completion gate", () => {
  it("is ready when every check is answered with evidence", () => {
    const r = reviewInspection(input());
    expect(r.blockers).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.summary.verdict).toBe("no_major_issues");
    expect(r.summary.counts).toMatchObject({ answered: 4, total: 4 });
  });

  it("blocks on an unanswered critical check, but only warns on a non-critical one", () => {
    const r = reviewInspection(
      input({ sections: { engine: { items: {} }, electricals: { items: { ecu_scan: rec("good", "No codes") } } } }),
    );
    expect(kinds(r.blockers)).toEqual(["critical_unanswered"]);
    expect(r.blockers[0].itemKey).toBe("leakage");
    expect(kinds(r.warnings)).toEqual(["unanswered", "unanswered"]);
    expect(r.summary.counts.unanswered).toBe(2);
  });

  it("requires a reason for every not-inspected check and lists it for the report", () => {
    const noReason = reviewInspection(input({ sections: { ...input().sections, engine: { items: { leakage: rec("not_inspected"), noise: rec("good", "OK") } } } }));
    expect(kinds(noReason.blockers)).toEqual(["missing_reason"]);

    const withReason = reviewInspection(
      input({
        sections: {
          ...input().sections,
          engine: { items: { leakage: rec("not_inspected", undefined, { notInspectedReason: "Engine bay locked" }), noise: rec("good", "OK") } },
        },
      }),
    );
    expect(withReason.ready).toBe(true);
    expect(withReason.summary.notInspected).toEqual([
      { sectionKey: "engine", sectionTitle: "Engine", itemKey: "leakage", label: "Leakage", reason: "Engine bay locked" },
    ]);
  });

  it("blocks until AI suggestions are confirmed or dismissed", () => {
    const finding = { id: "f1", sectionKey: "engine", itemKey: "noise", observedCondition: "Oil mist", severity: "monitor" as const };
    expect(kinds(reviewInspection(input({ findings: [{ ...finding, verificationStatus: "ai_suggested" }] })).blockers)).toEqual([
      "unverified_ai",
    ]);
    expect(reviewInspection(input({ findings: [{ ...finding, verificationStatus: "dismissed" }] })).ready).toBe(true);
  });

  it("blocks while a photo is still uploading", () => {
    const r = reviewInspection(input({ photos: [{ id: "p1", sectionKey: "engine", itemKey: "leakage", uploadState: "pending" }] }));
    expect(kinds(r.blockers)).toEqual(["photo_uploading"]);
  });

  it("needs a photo for a flagged photo check, and only warns for a good one", () => {
    const flagged = reviewInspection(
      input({ photos: [], sections: { ...input().sections, engine: { items: { leakage: rec("defect", "Bad"), noise: rec("good", "OK") } } } }),
    );
    expect(kinds(flagged.blockers)).toEqual(["missing_photo"]);
    expect(kinds(reviewInspection(input({ photos: [] })).warnings)).toEqual(["missing_photo"]);
  });
});

describe("contradictions", () => {
  const read = (payload: Partial<ReviewInput["obdReads"][number]["payload"]>, capturedAtMs = 1) => ({
    id: `r${capturedAtMs}`,
    sectionKey: "electricals",
    itemKey: "ecu_scan",
    capturedAtMs,
    payload: { stored: [], pending: [], milOn: false, simulated: false, ...payload },
  });

  it("flags an ECU-scan answer that disagrees with the latest read", () => {
    const r = reviewInspection(input({ obdReads: [read({ stored: ["P0301"] })] }));
    expect(kinds(r.blockers)).toEqual(["contradiction"]);
    expect(r.blockers[0].message).toContain("P0301");
  });

  it("uses the latest read, so re-reading after a repair resolves it", () => {
    const r = reviewInspection(input({ obdReads: [read({ stored: ["P0301"] }, 1), read({}, 2)] }));
    expect(r.ready).toBe(true);
  });

  it("flags 'no warning lamps' when the car reports the check-engine light on", () => {
    const r = reviewInspection(
      input({
        sections: { ...input().sections, electricals: { items: { ecu_scan: rec("defect", "Stored codes"), warning_lamps: rec("good", "None lit") } } },
        obdReads: [read({ stored: ["P0301"], milOn: true })],
      }),
    );
    expect(r.blockers.map((b) => b.itemKey)).toEqual(["warning_lamps"]);
  });

  it("flags a check rated good with a confirmed attention finding", () => {
    const r = reviewInspection(
      input({
        findings: [
          { id: "f1", sectionKey: "engine", itemKey: "noise", observedCondition: "Tappet noise", severity: "attention", verificationStatus: "confirmed" },
        ],
      }),
    );
    expect(kinds(r.blockers)).toEqual(["contradiction"]);
  });

  it("warns, without blocking, when the ECU scan used simulated data", () => {
    const r = reviewInspection(input({ obdReads: [read({ simulated: true })] }));
    expect(r.ready).toBe(true);
    expect(kinds(r.warnings)).toEqual(["simulated_obd"]);
    expect(r.summary.ecu?.simulated).toBe(true);
  });
});

describe("summary", () => {
  it("lists every attention and defect item with its evidence, and rates a critical defect as serious", () => {
    const r = reviewInspection(
      input({
        sections: {
          engine: { items: { leakage: rec("defect", "Bad", { remarks: "Oil under sump" }), noise: rec("good", "OK") } },
          electricals: { items: { ecu_scan: rec("good", "No codes"), warning_lamps: rec("attention", "Lamp lit") } },
        },
        findings: [
          { id: "f1", sectionKey: "engine", itemKey: "leakage", observedCondition: "Wet sump", severity: "attention", verificationStatus: "confirmed" },
        ],
      }),
    );
    expect(r.summary.flagged.map((f) => [f.itemKey, f.status])).toEqual([
      ["leakage", "defect"],
      ["warning_lamps", "attention"],
    ]);
    expect(r.summary.flagged[0]).toMatchObject({ remarks: "Oil under sump", photoIds: ["p1"], critical: true });
    expect(r.summary.flagged[0].findings).toEqual([{ id: "f1", observedCondition: "Wet sump", severity: "attention" }]);
    expect(r.summary.verdict).toBe("serious_issues");
  });

  it("rates problems outside critical checks and sections as issues found", () => {
    const r = reviewInspection(
      input({
        sections: { ...input().sections, electricals: { items: { ecu_scan: rec("good", "No codes"), warning_lamps: rec("attention", "Lamp lit") } } },
      }),
    );
    expect(r.summary.verdict).toBe("issues_found");
  });

  it("rates any defect in a critical section as serious", () => {
    const r = reviewInspection(
      input({ sections: { ...input().sections, engine: { items: { leakage: rec("good", "OK"), noise: rec("defect", "Bad") } } } }),
    );
    expect(r.summary.verdict).toBe("serious_issues");
  });

  it("works on the real checklist: a fresh inspection is blocked by every critical check", () => {
    const r = reviewInspection({ checklist: PPI_V1, sections: {}, photos: [], obdReads: [], findings: [] });
    const critical = PPI_V1.sections.flatMap((s) => s.items.filter((i) => i.critical));
    expect(r.blockers).toHaveLength(critical.length);
  });
});

describe("formatValue", () => {
  it("formats panels, tread and numbers", () => {
    const panel = PPI_V1.sections.find((s) => s.key === "body_panels")!.items[0];
    expect(formatValue(panel, { status: "attention", label: "", value: { paint: "Repainted", structure: "Good" } })).toBe(
      "Paint: Repainted · Structure: Good",
    );
    const tyre = PPI_V1.sections.find((s) => s.key === "tyres")!.items[0];
    expect(formatValue(tyre, { status: "attention", label: "", value: 2.4 })).toBe("2.4 mm (12% left)");
    const odo = PPI_V1.sections[0].items.find((i) => i.key === "odometer")!;
    expect(formatValue(odo, { status: "good", label: "", value: 42000, unit: "km" })).toBe("42,000 km");
  });
});

describe("extended ECU facts", () => {
  const ext = {
    vin: "MA3EWDE1SS0123456",
    odometerKm: 61_000,
    distanceSinceClearKm: 40,
    warmUpsSinceClear: 3,
    distanceWithMilKm: null,
    permanent: [],
    monitors: [{ name: "Catalytic converter", complete: false }],
    flags: [{ id: "recent_clear", title: "Trouble codes were cleared recently", body: "…" }],
  };
  const withOdo = (value: number): ReviewInput => {
    const base = input({
      obdReads: [{ id: "o1", sectionKey: "electricals", itemKey: "ecu_scan", payload: { stored: [], pending: [], milOn: false, simulated: false, extended: ext } }],
    });
    const cl: Checklist = {
      ...checklist,
      sections: [...checklist.sections, { key: "vehicle_details", title: "Vehicle", items: [{ key: "odometer", label: "Odometer reading", input: { kind: "number", unit: "km" } }] }],
    };
    return { ...base, checklist: cl, sections: { ...base.sections, vehicle_details: { items: { odometer: { status: "good", label: "Odometer", value } } } } };
  };

  it("warns about recently cleared codes and carries the facts into the summary", () => {
    const r = reviewInspection(withOdo(61_200));
    expect(kinds(r.warnings)).toContain("obd_cleared");
    expect(kinds(r.warnings)).not.toContain("odometer_mismatch");
    expect(r.summary.ecu?.extended?.vin).toBe("MA3EWDE1SS0123456");
  });

  it("flags a dashboard odometer far below the ECU's", () => {
    const r = reviewInspection(withOdo(31_000));
    expect(r.warnings.find((w) => w.kind === "odometer_mismatch")?.message).toContain("61,000");
  });
});
