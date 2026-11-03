import { describe, expect, it, vi } from "vitest";
import { summarizeSession } from "../functions/src/analyze-session";
import { MetaClient } from "../functions/src/shared/meta-client";
import type { InspectionSummaryReport } from "../lib/diagnostics/evidence-engine";
import { sessionContext, sessionVehicle } from "../lib/diagnostics/session-context";
import { validateSessionAnalysis } from "../lib/schemas/session";

const summary: InspectionSummaryReport = {
  verdict: "serious_issues",
  counts: { defect: 1, attention: 1, notInspected: 1, unanswered: 0, answered: 10, total: 11 },
  flagged: [
    {
      sectionKey: "engine",
      sectionTitle: "Engine",
      itemKey: "compression_leak",
      label: "Compression leak",
      status: "defect",
      value: "Yes",
      remarks: "Blow-by from oil filler",
      critical: true,
      photoIds: [],
      obdReadId: null,
      findings: [],
    },
    {
      sectionKey: "body_panels",
      sectionTitle: "Body panels",
      itemKey: "hood",
      label: "Hood",
      status: "attention",
      value: "Paint: Repainted · Structure: Good",
      remarks: null,
      critical: false,
      photoIds: ["p1"],
      obdReadId: null,
      findings: [{ id: "f1", observedCondition: "Shade differs from fender", severity: "attention" }],
    },
  ],
  notInspected: [{ sectionKey: "brakes", sectionTitle: "Brakes", itemKey: "side_pull", label: "Pulling to one side", reason: "No road test" }],
  ecu: { stored: ["P0301"], pending: [], milOn: true, simulated: false },
};
const vehicle = { make: "Maruti Suzuki", model: "Swift", variant: "VXi", year: 2019, fuel: "Petrol", odometerKm: 42000 };

const good = {
  overview: "The engine shows a compression leak and a stored misfire code for cylinder 1. The hood has been repainted.",
  hypotheses: [
    {
      statement: "The misfire code and the compression leak could share a cause in cylinder 1.",
      basis: "measured",
      confidence: "medium",
      evidenceRefs: ["P0301", "engine/compression_leak"],
      nextStep: "Do a compression test on all cylinders.",
    },
  ],
};

function reply(content: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 900, completion_tokens: 250 } }),
    { status: 200 },
  );
}
const client = (f: unknown) => new MetaClient({ apiKey: "LLM_test", fetchImpl: f as typeof fetch, baseDelayMs: 1 });

describe("sessionContext", () => {
  it("tags every flagged check and code as a citable ref, and leaves out the registration", () => {
    const { text, refs } = sessionContext({ vehicle, summary });
    expect([...refs].sort()).toEqual(["P0301", "body_panels/hood", "engine/compression_leak"]);
    expect(text).toContain("[engine/compression_leak] Engine › Compression leak: DEFECT (Yes); inspector remark: Blow-by");
    expect(text).toContain("confirmed photo finding (attention): Shade differs from fender");
    expect(text).toContain("Pulling to one side: No road test");
    expect(text).toContain("2019 Maruti Suzuki Swift VXi Petrol 42000 km");
  });

  it("marks simulated OBD data", () => {
    expect(sessionContext({ vehicle, summary: { ...summary, ecu: { ...summary.ecu!, simulated: true } } }).text).toContain(
      "SIMULATED",
    );
  });

  it("takes fuel and odometer from Vehicle details", () => {
    expect(
      sessionVehicle({ make: "Tata", model: "Nexon" }, {
        fuel_type: { status: "good", label: "", value: "Diesel" },
        odometer: { status: "good", label: "", value: 9000 },
      }),
    ).toEqual({ make: "Tata", model: "Nexon", variant: null, year: null, fuel: "Diesel", odometerKm: 9000 });
  });
});

describe("validateSessionAnalysis", () => {
  const refs = sessionContext({ vehicle, summary }).refs;

  it("drops hypotheses that cite evidence that wasn't given", () => {
    const invented = { ...good.hypotheses[0], evidenceRefs: ["P0420"] };
    const r = validateSessionAnalysis({ ...good, hypotheses: [good.hypotheses[0], invented] }, refs);
    expect(r?.analysis.hypotheses).toHaveLength(1);
    expect(r?.dropped).toBe(1);
  });

  it("drops hypotheses with no evidence or a numeric confidence", () => {
    const r = validateSessionAnalysis(
      { ...good, hypotheses: [{ ...good.hypotheses[0], evidenceRefs: [] }, { ...good.hypotheses[0], confidence: 0.9 }] },
      refs,
    );
    expect(r?.analysis.hypotheses).toEqual([]);
  });

  it("rejects an envelope without an overview", () => {
    expect(validateSessionAnalysis({ hypotheses: [] }, refs)).toBeNull();
  });
});

describe("summarizeSession", () => {
  it("returns the validated analysis and the context it was based on", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(good));
    const r = await summarizeSession({ vehicle, summary }, client(fetchImpl));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.analysis.hypotheses).toHaveLength(1);
    expect(r.context).toBe(sessionContext({ vehicle, summary }).text);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[1].content).toContain("[P0301]");
  });

  it("retries once on unusable output, then reports AI unavailable", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => reply({ nope: true }));
    const r = await summarizeSession({ vehicle, summary }, client(fetchImpl));
    expect(r.status).toBe("ai_unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.usage).toHaveLength(2);
  });
});
