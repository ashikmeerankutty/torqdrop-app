import { describe, expect, it, vi } from "vitest";
import { readDocument } from "../functions/src/scan-document";
import { MetaClient } from "../functions/src/shared/meta-client";
import { registrationMismatch, scanToAnswers } from "../lib/diagnostics/document-fields";
import { type DocumentScan, validateDocumentScan } from "../lib/schemas/document";

const rcFields = {
  regNo: "KA 01 AB 1234",
  make: "MARUTI SUZUKI INDIA LTD",
  model: "SWIFT VXI",
  variant: null,
  colour: "PEARL WHITE",
  fuel: "Petrol",
  mfgMonthYear: "03/2019",
  registrationDate: "2019-04-12",
  seatingCapacity: 5,
  ownerSerial: 2,
  hypothecation: "active",
  chassisNumber: "MA3EWDE1S00123456",
  engineNumber: "K12MN1234567",
  rto: "KA01 BANGALORE CENTRAL",
};

describe("validateDocumentScan", () => {
  it("normalises the registration and keeps valid fields", () => {
    const scan = validateDocumentScan("rc", { readable: true, problem: null, fields: rcFields });
    expect(scan?.fields).toMatchObject({ regNo: "KA01AB1234", fuel: "Petrol", ownerSerial: 2 });
  });

  it("nulls a misread field on its own instead of rejecting the scan", () => {
    const scan = validateDocumentScan("rc", {
      readable: true,
      problem: null,
      fields: { ...rcFields, registrationDate: "12/04/2019", fuel: "Kerosene", ownerSerial: 0 },
    });
    expect(scan?.fields).toMatchObject({ registrationDate: null, fuel: null, ownerSerial: null, make: "MARUTI SUZUKI INDIA LTD" });
  });

  it("drops fields that aren't in the schema, such as an owner name", () => {
    const scan = validateDocumentScan("rc", { readable: true, problem: null, fields: { ...rcFields, ownerName: "R Kumar" } });
    expect(scan?.fields).not.toHaveProperty("ownerName");
  });

  it("rejects an envelope with no fields", () => {
    expect(validateDocumentScan("insurance", { readable: true })).toBeNull();
  });
});

describe("scanToAnswers", () => {
  const rc = validateDocumentScan("rc", { readable: true, problem: null, fields: rcFields }) as DocumentScan;

  it("maps RC fields to checklist answers rated by the checklist's own rules", () => {
    const { answers, references } = scanToAnswers(rc, "2026-10-28");
    const byKey = Object.fromEntries(answers.map((a) => [a.itemKey, a]));
    expect(byKey.reg_no.value).toBe("KA01AB1234");
    expect(byKey.fuel_type.record.status).toBe("good");
    expect(byKey.owners.value).toBe(2);
    expect(byKey.hypothecation).toMatchObject({ value: "Active", record: { status: "attention" } });
    expect(byKey.registration_date.value).toBe("2019-04-12");
    expect(byKey.variant).toBeUndefined();
    expect(references.map((r) => r.label)).toEqual(["Chassis number on RC", "Engine number on RC"]);
  });

  it("rates an expired policy as attention", () => {
    const ins = validateDocumentScan("insurance", {
      readable: true,
      problem: null,
      fields: { regNo: "KA01AB1234", insurer: "Acme General", policyType: "Comprehensive", expiry: "2026-01-31", zeroDepreciation: true },
    }) as DocumentScan;
    const { answers } = scanToAnswers(ins, "2026-10-28");
    expect(answers.find((a) => a.itemKey === "insurance_expiry")?.record.status).toBe("attention");
    expect(answers.find((a) => a.itemKey === "insurance_type")?.value).toBe("Comprehensive");
  });

  it("warns when the document is for a different car", () => {
    expect(registrationMismatch(rc, "KA 01 AB 1234")).toBeNull();
    expect(registrationMismatch(rc, "MH12XY9999")).toContain("KA01AB1234");
  });
});

describe("readDocument", () => {
  const reply = (content: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1500, completion_tokens: 300 } }), {
      status: 200,
    });
  const client = (f: unknown) => new MetaClient({ apiKey: "LLM_test", fetchImpl: f as typeof fetch, baseDelayMs: 1 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

  it("sends the photo inline and returns the validated scan", async () => {
    const f = vi.fn().mockImplementation(async () => reply({ readable: true, problem: null, fields: rcFields }));
    const r = await readDocument("rc", jpeg, client(f));
    expect(r.status).toBe("ok");
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("retries once, then reports AI unavailable", async () => {
    const f = vi.fn().mockImplementation(async () => reply({ nonsense: true }));
    expect((await readDocument("insurance", jpeg, client(f))).status).toBe("ai_unavailable");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
