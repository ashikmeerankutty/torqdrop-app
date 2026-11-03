import { describe, expect, it, vi } from "vitest";
import { analyzeLive } from "../functions/src/analyze-live";
import { MetaApiError, MetaClient } from "../functions/src/shared/meta-client";
import { SnapshotBuilder } from "../lib/obd/snapshot-builder";

const snap = (() => {
  const b = new SnapshotBuilder({ windowSeconds: 30, simulated: false }, () => 1_000_000);
  b.addReading("rpm", "rpm", 850);
  b.addReading("coolantTemp", "°C", 92);
  b.setDtcs(["P0133"], []);
  b.setMil(true, 1);
  return b.build("new_dtc");
})();

const goodCard = {
  kind: "warning",
  title: "Oxygen sensor code stored",
  body: "Code P0133 points to the oxygen sensor circuit. It is a system to check, not a confirmed failed part.",
  basis: "measured",
  severity: "attention",
  confidence: "medium",
  uncertainty: "A single code without freeze-frame data.",
  evidenceRefs: ["P0133"],
};

function reply(content: unknown, usage = { prompt_tokens: 700, completion_tokens: 400 }) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage }), {
    status: 200,
  });
}

function client(fetchImpl: typeof fetch) {
  return new MetaClient({ apiKey: "LLM_test", fetchImpl, baseDelayMs: 1 });
}

describe("analyzeLive", () => {
  it("returns validated cards and computes cost", async () => {
    const f = vi.fn(async () => reply({ cards: [goodCard] }));
    const r = await analyzeLive(snap, client(f as unknown as typeof fetch));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.cards).toHaveLength(1);
    // 700*1.25 + 400*4.25 = 2575 per million
    expect(r.usage[0].costUsd).toBeCloseTo(0.002575, 6);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
  });

  it("treats an empty card list as a valid answer", async () => {
    const f = vi.fn(async () => reply({ cards: [] }));
    const r = await analyzeLive(snap, client(f as unknown as typeof fetch));
    expect(r).toMatchObject({ status: "ok", cards: [] });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries once when every card is invalid, then recovers", async () => {
    const bad = { cards: [{ ...goodCard, evidenceRefs: ["P0300"] }] };
    const f = vi.fn().mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply({ cards: [goodCard] }));
    const r = await analyzeLive(snap, client(f as unknown as typeof fetch));
    expect(r.status).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
    if (r.status === "ok") expect(r.usage).toHaveLength(2);
  });

  it("reports ai_unavailable after two invalid attempts", async () => {
    const bad = { cards: [{ ...goodCard, evidenceRefs: ["P0300"] }] };
    const f = vi.fn(async () => reply(bad));
    const r = await analyzeLive(snap, client(f as unknown as typeof fetch));
    expect(r.status).toBe("ai_unavailable");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed snapshot before calling the API", async () => {
    const f = vi.fn();
    await expect(analyzeLive({ nope: true }, client(f as unknown as typeof fetch))).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("MetaClient", () => {
  it("retries 429 then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(reply({ cards: [] }));
    const { json } = await client(f as unknown as typeof fetch).completeJson({
      system: "s",
      user: "u",
      schemaName: "x",
      schema: { type: "object" },
    });
    expect(json).toEqual({ cards: [] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    await expect(
      client(f as unknown as typeof fetch).completeJson({ system: "s", user: "u", schemaName: "x", schema: {} }),
    ).rejects.toBeInstanceOf(MetaApiError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses contributor models", async () => {
    const f = vi.fn();
    await expect(
      client(f as unknown as typeof fetch).completeJson({
        model: "muse-spark-1.3-contributor",
        system: "s",
        user: "u",
        schemaName: "x",
        schema: {},
      }),
    ).rejects.toThrow(/Contributor/);
    expect(f).not.toHaveBeenCalled();
  });
});
