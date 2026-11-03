import { describe, expect, it, vi } from "vitest";
import { analyzePhoto, itemContext } from "../functions/src/analyze-photo";
import { MetaClient } from "../functions/src/shared/meta-client";
import { validatePhotoAnalysis } from "../lib/schemas/finding";

const finding = {
  observedCondition: "Paint on the front door looks slightly different in shade from the fender.",
  severity: "attention",
  confidence: "medium",
  aiInterpretation: "May indicate a repaint, though lighting can also cause shade differences.",
  uncertainty: "One photo in uneven light.",
  missingEvidence: ["Photo in daylight from a 45° angle", "Paint thickness reading"],
  nextAction: "Check panel gaps and use a paint-thickness gauge on the door and fender.",
};

function reply(content: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1500, completion_tokens: 300 } }),
    { status: 200 },
  );
}

const client = (f: unknown) => new MetaClient({ apiKey: "LLM_test", fetchImpl: f as typeof fetch, baseDelayMs: 1 });
const input = { sectionKey: "body_panels", itemKey: "front_door_rhs", image: Buffer.from([0xff, 0xd8, 0xff]), mime: "image/jpeg" };

describe("itemContext", () => {
  it("describes the item and its rating labels", () => {
    expect(itemContext("body_panels", "front_door_rhs")).toContain("Front door, RHS");
    expect(itemContext("body_panels", "front_door_rhs")).toContain("Repainted");
    expect(itemContext("tyres", "tyre_fr")).toContain("1.6 mm");
    expect(itemContext("nope", "x")).toBeNull();
  });
});

describe("validatePhotoAnalysis", () => {
  it("drops invalid findings individually and caps at three", () => {
    const r = validatePhotoAnalysis({ imageUsable: true, findings: [finding, { severity: "bad" }, finding, finding, finding] });
    expect(r?.analysis.findings).toHaveLength(3);
    expect(r?.dropped).toBe(2);
  });

  it("discards findings when the image is unusable", () => {
    const r = validatePhotoAnalysis({ imageUsable: false, unusableReason: "Too dark", findings: [finding] });
    expect(r?.analysis).toEqual({ imageUsable: false, unusableReason: "Too dark", findings: [] });
  });

  it("rejects a malformed envelope", () => {
    expect(validatePhotoAnalysis(null)).toBeNull();
    expect(validatePhotoAnalysis({ findings: [] })).toBeNull();
  });
});

describe("analyzePhoto", () => {
  it("sends the photo with item context and returns validated findings", async () => {
    const f = vi.fn(async () => reply({ imageUsable: true, findings: [finding] }));
    const r = await analyzePhoto(input, client(f));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.analysis.findings[0].severity).toBe("attention");

    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    const content = body.messages[1].content;
    expect(content[0].text).toContain("Front door, RHS");
    expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.model).toBe("muse-spark-1.3");
  });

  it("retries unparseable output once, then reports AI unavailable", async () => {
    const f = vi.fn(async () => reply("not json at all"));
    const r = await analyzePhoto(input, client(f));
    expect(r.status).toBe("ai_unavailable");
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.usage).toHaveLength(2);
  });

  it("rejects an unknown checklist item before calling the model", async () => {
    const f = vi.fn();
    await expect(analyzePhoto({ ...input, itemKey: "nope" }, client(f))).rejects.toThrow("Unknown checklist item");
    expect(f).not.toHaveBeenCalled();
  });
});
