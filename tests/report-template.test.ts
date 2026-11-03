import { describe, expect, it } from "vitest";
import { PPI_V1 } from "../lib/diagnostics/checklists/ppi-v1";
import { reviewInspection } from "../lib/diagnostics/evidence-engine";
import { DISCLAIMER, escapeHtml, formatDate, type ReportData, renderReportHtml } from "../lib/report/html-template";

const XSS = `<img src=x onerror="alert(1)">`;

function data(over: Partial<ReportData> = {}): ReportData {
  const sections = {
    engine: { items: { leakage: { status: "defect" as const, label: "Leakage", value: "Yes", remarks: `Oil ${XSS}` } } },
    flood: { items: { rusted_bolts: { status: "not_inspected" as const, label: "Rusted bolts", notInspectedReason: "Too dark" } } },
  };
  const { summary } = reviewInspection({
    checklist: PPI_V1,
    sections,
    photos: [{ id: "ph1", sectionKey: "engine", itemKey: "leakage", uploadState: "uploaded" }],
    obdReads: [
      {
        id: "r1",
        sectionKey: "electricals",
        itemKey: "ecu_scan",
        capturedAtMs: 1,
        payload: { stored: ["P0301"], pending: [], milOn: true, simulated: true },
      },
    ],
    findings: [],
  });
  return {
    reportId: "rep1",
    generatedAt: new Date("2026-10-28T05:30:00Z"),
    signOff: { name: `Ravi ${XSS}`, at: new Date("2026-10-28T05:30:00Z") },
    vehicle: { regNo: "KA01AB1234", make: "Maruti Suzuki", model: "Swift", variant: "VXi", year: 2019, fuel: "Petrol", odometerKm: 42000 },
    checklist: PPI_V1,
    sections,
    summary,
    aiSummary: null,
    findings: [
      {
        id: "f1",
        sectionKey: "engine",
        itemKey: "leakage",
        observedCondition: "Wet oil residue under the sump",
        severity: "attention",
        confidence: "medium",
        aiInterpretation: "May indicate a gasket leak",
        uncertainty: "Could be from a recent oil change",
      },
    ],
    photos: [{ id: "ph1", sectionKey: "engine", itemKey: "leakage" }],
    ecuReadAt: new Date("2026-10-28T05:00:00Z"),
    warnings: [],
    ...over,
  };
}

const render = (d = data()) => renderReportHtml(d, { photoUrl: (id) => `/r/TOKEN/p/${id}`, nonce: "abc" });

describe("renderReportHtml", () => {
  it("escapes every piece of user text", () => {
    const html = render();
    expect(html).not.toContain(XSS);
    expect(html).toContain("Oil &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Ravi &lt;img");
  });

  it("only runs scripts and styles carrying the nonce", () => {
    const html = render();
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).toContain('<script nonce="abc">');
    expect(html).toContain('<style nonce="abc">');
  });

  it("puts every flagged check in the summary with its evidence and uncertainty", () => {
    const html = render();
    const summary = html.slice(html.indexOf("Summary of issues"), html.indexOf("All checks"));
    expect(summary).toContain("Leakage");
    expect(summary).toContain("Wet oil residue under the sump");
    expect(summary).toContain("Uncertainty: Could be from a recent oil change");
    expect(summary).toContain('src="/r/TOKEN/p/ph1"');
  });

  it("lists not-inspected checks with reasons and shows unanswered checks as Not checked", () => {
    const html = render();
    expect(html).toContain("Too dark");
    expect(html).toContain("Not checked");
  });

  it("labels simulated OBD data and AI-written text", () => {
    const html = render(
      data({
        aiSummary: {
          overview: "The engine leaks oil.",
          hypotheses: [{ statement: "Gasket may leak", basis: "inspector_observed", confidence: "low", evidenceRefs: ["engine/leakage"], nextStep: "Clean and recheck" }],
        },
      }),
    );
    expect(html).toContain("SIMULATED DATA");
    expect(html).toContain("P0301");
    expect(html).toContain("AI-written summary");
    expect(html).toContain("possibility, not a diagnosis");
  });

  it("always ends with the disclaimer and has every section table", () => {
    const html = render();
    expect(html).toContain(escapeHtml(DISCLAIMER));
    for (const s of PPI_V1.sections) expect(html).toContain(`<h3>${escapeHtml(s.title)}</h3>`);
  });

  it("formats dates in India time", () => {
    expect(formatDate(new Date("2026-10-28T05:30:00Z"))).toContain("11:00");
  });
});
