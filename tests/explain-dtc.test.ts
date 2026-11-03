import { describe, expect, it, vi } from "vitest";
import { diagnoseContext, explainDiagnostics } from "../functions/src/explain-dtc";
import { MetaClient } from "../functions/src/shared/meta-client";
import { redactFreeText } from "../lib/diagnostics/symptoms";
import { DiagnoseRequest, validateDiagnosis } from "../lib/schemas/diagnosis";
import type { LiveSnapshot } from "../lib/schemas/snapshot";

const code = (c: string, over = {}) => ({
  code: c,
  meaning: "The engine computer saw cylinder 1 misfire.",
  possibleCauses: ["Worn spark plug", "Faulty ignition coil"],
  severity: "attention",
  driveAdvice: "ok",
  driveNote: "Drive gently.",
  checks: ["Swap coils between cylinders"],
  ...over,
});

const output = (over = {}) => ({
  summary: "Cylinder 1 is misfiring.",
  codes: [code("P0301")],
  possibilities: [{ statement: "A weak coil could cause the rough idle.", basedOn: ["P0301", "rough_idle"], confidence: "medium" }],
  nextSteps: ["Avoid hard acceleration"],
  driveAdvice: "ok",
  ...over,
});

const req = (over = {}) => DiagnoseRequest.parse({ codes: ["P0301"], symptoms: ["rough_idle"], ...over });

const snapshot = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({
  capturedAt: "2026-10-28T05:00:00.000Z",
  windowSeconds: 30,
  simulated: false,
  mil: { on: false, dtcCount: 0 },
  dtcs: { stored: [], pending: [] },
  pids: { coolantTemp: { unit: "°C", last: 90, min: 88, avg: 89, max: 90, samples: 10 } },
  unsupportedPids: [],
  trigger: "manual",
  ...over,
});

describe("DiagnoseRequest", () => {
  it("needs at least one code or symptom and rejects malformed codes", () => {
    expect(DiagnoseRequest.safeParse({}).success).toBe(false);
    expect(DiagnoseRequest.safeParse({ codes: ["P030"] }).success).toBe(false);
    expect(DiagnoseRequest.safeParse({ symptoms: ["not_a_symptom"] }).success).toBe(false);
    expect(DiagnoseRequest.safeParse({ description: "Car pulls left" }).success).toBe(true);
  });
});

describe("validateDiagnosis", () => {
  it("never advises driving on when the safety rules say stop", () => {
    // P0301 is a misfire: the deterministic rules say urgent, whatever the model says.
    const r = validateDiagnosis(output(), req());
    expect(r?.diagnosis.driveAdvice).toBe("stop");
    expect(r?.diagnosis.codes[0]).toMatchObject({ driveAdvice: "stop", severity: "urgent" });
  });

  it("raises drive advice to stop when live coolant is overheating", () => {
    const r = validateDiagnosis(
      output({ codes: [code("P0128", { driveAdvice: "ok" })], possibilities: [] }),
      req({ codes: ["P0128"], symptoms: [], snapshot: snapshot({ pids: { coolantTemp: { unit: "°C", last: 118, min: 110, avg: 114, max: 118, samples: 10 } } }) }),
    );
    expect(r?.diagnosis.driveAdvice).toBe("stop");
  });

  it("keeps the model's advice when it's already more cautious than the rules", () => {
    const r = validateDiagnosis(output({ codes: [], driveAdvice: "caution", possibilities: [] }), req({ codes: [], symptoms: ["noise"] }));
    expect(r?.diagnosis.driveAdvice).toBe("caution");
  });

  it("drops codes that weren't asked about, duplicates, and possibilities citing unknown refs", () => {
    const r = validateDiagnosis(
      output({
        codes: [code("P0301"), code("P0301"), code("P0420")],
        possibilities: [
          { statement: "Fine", basedOn: ["rough_idle"], confidence: "low" },
          { statement: "Invented", basedOn: ["oilPressure"], confidence: "high" },
        ],
      }),
      req(),
    );
    expect(r?.diagnosis.codes.map((c) => c.code)).toEqual(["P0301"]);
    expect(r?.diagnosis.possibilities.map((p) => p.statement)).toEqual(["Fine"]);
    expect(r?.dropped).toBe(3);
  });

  it("allows citing live data and the free-text description when given", () => {
    const r = validateDiagnosis(
      output({ codes: [], possibilities: [{ statement: "Runs cool", basedOn: ["coolantTemp", "description"], confidence: "low" }] }),
      req({ codes: [], symptoms: [], description: "Heater blows cold", snapshot: snapshot() }),
    );
    expect(r?.diagnosis.possibilities).toHaveLength(1);
  });

  it("rejects an envelope without a summary", () => {
    expect(validateDiagnosis({ codes: [] }, req())).toBeNull();
  });
});

describe("redactFreeText", () => {
  it("strips emails, phone numbers and registration numbers", () => {
    expect(redactFreeText("Call me on +91 98765 43210 or a@b.co, car KA01AB1234 knocks")).toBe(
      "Call me on [number] or [email], car [registration] knocks",
    );
  });

  it("leaves ordinary lowercase text with numbers alone", () => {
    expect(redactFreeText("it shakes at 40 1500 rpm")).toBe("it shakes at 40 1500 rpm");
  });
});

describe("diagnoseContext", () => {
  it("tags codes, symptoms and live data, and marks simulated data", () => {
    const text = diagnoseContext(
      req({ description: "Shakes at KA 01 AB 1234 signal", snapshot: snapshot({ simulated: true, mil: { on: true, dtcCount: 1 } }) }),
    );
    expect(text).toContain("[P0301] Cylinder 1 misfire");
    expect(text).toContain("[rough_idle] Rough or shaky idle");
    expect(text).toContain("[registration]");
    expect(text).not.toContain("1234");
    expect(text).toContain("SIMULATED");
    expect(text).toContain("[mil] check-engine light ON");
  });
});

describe("explainDiagnostics", () => {
  const reply = (content: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 600, completion_tokens: 300 } }), {
      status: 200,
    });
  const client = (f: unknown) => new MetaClient({ apiKey: "LLM_test", fetchImpl: f as typeof fetch, baseDelayMs: 1 });

  it("returns the validated diagnosis", async () => {
    const r = await explainDiagnostics(req(), client(vi.fn().mockImplementation(async () => reply(output()))));
    expect(r.status).toBe("ok");
  });

  it("retries once, then reports AI unavailable", async () => {
    const f = vi.fn().mockImplementation(async () => reply({ nope: 1 }));
    const r = await explainDiagnostics(req(), client(f));
    expect(r.status).toBe("ai_unavailable");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
