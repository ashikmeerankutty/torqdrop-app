import { describe, expect, it } from "vitest";
import { SnapshotBuilder } from "../lib/obd/snapshot-builder";
import { InsightResponse, insightJsonSchema, validateInsights } from "../lib/schemas/insight";
import { LiveSnapshot } from "../lib/schemas/snapshot";

function snapshot() {
  let t = 1_000_000;
  const b = new SnapshotBuilder({ windowSeconds: 30, simulated: true }, () => t);
  b.addReading("rpm", "rpm", 800);
  t += 1000;
  b.addReading("rpm", "rpm", 2000);
  b.addReading("coolantTemp", "°C", 90);
  b.markUnsupported("longFuelTrim1");
  b.setMil(true, 1);
  b.setDtcs(["P0133"], []);
  return b.build("new_dtc");
}

const card = (over: object = {}) => ({
  kind: "insight",
  title: "Idle looks normal",
  body: "Engine speed ranged 800-2000 rpm in the window.",
  basis: "measured",
  severity: "info",
  confidence: "high",
  uncertainty: "Short window.",
  evidenceRefs: ["rpm"],
  ...over,
});

describe("SnapshotBuilder", () => {
  it("summarises a window and passes the schema", () => {
    const s = snapshot();
    expect(LiveSnapshot.safeParse(s).success).toBe(true);
    expect(s.pids.rpm).toMatchObject({ min: 800, max: 2000, avg: 1400, last: 2000, samples: 2 });
    expect(s.unsupportedPids).toEqual(["longFuelTrim1"]);
    expect(s.pids.longFuelTrim1).toBeUndefined();
  });

  it("drops samples older than the window", () => {
    let t = 0;
    const b = new SnapshotBuilder({ windowSeconds: 10, simulated: false }, () => t);
    b.addReading("speed", "km/h", 50);
    t = 20_000;
    b.addReading("speed", "km/h", 60);
    expect(b.build("interval").pids.speed.samples).toBe(1);
  });
});

describe("validateInsights", () => {
  const s = snapshot();

  it("keeps valid cards and sorts most severe first", () => {
    const r = validateInsights(s, {
      cards: [card(), card({ title: "Code stored", severity: "attention", evidenceRefs: ["P0133"] })],
    });
    expect(r.cards.map((c) => c.severity)).toEqual(["attention", "info"]);
    expect(r.dropped).toBe(0);
  });

  it("drops cards citing evidence not in the snapshot", () => {
    const r = validateInsights(s, { cards: [card({ evidenceRefs: ["P0300"] })] });
    expect(r.cards).toHaveLength(0);
    expect(r.dropped).toBe(1);
  });

  it("drops chart hints for unsupported PIDs", () => {
    const r = validateInsights(s, {
      cards: [card({ chart: { pid: "longFuelTrim1", windowSeconds: 60 } })],
    });
    expect(r.dropped).toBe(1);
  });

  it("drops malformed cards but keeps the rest", () => {
    const r = validateInsights(s, { cards: [card(), { title: "no body" }] });
    expect(r.cards).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it("never throws on garbage", () => {
    expect(validateInsights(s, "nonsense")).toEqual({ cards: [], dropped: 0 });
    expect(validateInsights(s, null)).toEqual({ cards: [], dropped: 0 });
  });

  it("rejects numeric confidence", () => {
    expect(InsightResponse.safeParse({ cards: [card({ confidence: 0.9 })] }).success).toBe(false);
  });

  it("produces a JSON schema for the Meta API", () => {
    expect(insightJsonSchema).toMatchObject({ type: "object" });
  });
});
