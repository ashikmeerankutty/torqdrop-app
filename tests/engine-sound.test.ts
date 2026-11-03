import { describe, expect, it } from "vitest";

import { engineClipContext } from "../functions/src/engine-sound";
import { parseJsonReply } from "../functions/src/shared/meta-client";
import { AnalyzeEngineClipRequest, type EngineClipContext, validateEngineSound } from "../lib/schemas/engine-sound";

const ctx = (over: Partial<EngineClipContext> = {}): EngineClipContext => ({
  durationS: 18,
  place: "engine_bay",
  engineWarm: true,
  concerns: ["ticking"],
  vehicle: { make: "Maruti Suzuki", model: "Swift", year: 2019, fuel: "petrol", displacementL: 1.2, odometerKm: 64000 },
  ...over,
});

const sound = (over: Record<string, unknown> = {}) => ({
  kind: "tick",
  fromS: 2,
  toS: 6,
  description: "Light fast ticking at idle that follows engine speed.",
  likelySources: ["Valve clearance or lifters", "Low oil level"],
  confidence: "medium",
  severity: "monitor",
  ...over,
});

const reply = (over: Record<string, unknown> = {}) => ({
  clipQuality: "good",
  qualityNote: "",
  summary: "A light ticking is audible at idle.",
  idleRhythm: "even",
  sounds: [sound()],
  seen: [],
  obdNotes: [],
  nextSteps: ["Check the oil level"],
  driveAdvice: "ok",
  ...over,
});

describe("validateEngineSound", () => {
  it("accepts a well-formed reply", () => {
    const v = validateEngineSound(reply(), ctx());
    expect(v?.result.sounds).toHaveLength(1);
    expect(v?.result.driveAdvice).toBe("ok");
    expect(v?.dropped).toBe(0);
  });

  it("returns null for an unusable envelope", () => {
    expect(validateEngineSound({ summary: "x" }, ctx())).toBeNull();
    expect(validateEngineSound(null, ctx())).toBeNull();
  });

  it("drops bad sounds one by one and clamps times to the clip", () => {
    const v = validateEngineSound(reply({ sounds: [sound({ kind: "banana" }), sound({ fromS: 15, toS: 40 }), sound({ fromS: 10, toS: 3 })] }), ctx());
    expect(v?.dropped).toBe(1);
    expect(v?.result.sounds[0]).toMatchObject({ fromS: 15, toS: 18 });
    expect(v?.result.sounds[1]).toMatchObject({ fromS: 10, toS: 10 });
  });

  it("raises drive advice for attention and confident urgent sounds, never lowers it", () => {
    expect(validateEngineSound(reply({ sounds: [sound({ severity: "attention" })] }), ctx())?.result.driveAdvice).toBe("caution");
    expect(validateEngineSound(reply({ sounds: [sound({ kind: "knock", severity: "urgent" })] }), ctx())?.result.driveAdvice).toBe("stop");
    expect(validateEngineSound(reply({ sounds: [sound({ kind: "knock", severity: "urgent", confidence: "low" })] }), ctx())?.result.driveAdvice).toBe("caution");
    expect(validateEngineSound(reply({ sounds: [], driveAdvice: "stop" }), ctx())?.result.driveAdvice).toBe("stop");
  });

  it("applies the OBD safety floor: a misfire code means stop", () => {
    const withObd = ctx({ obd: { simulated: false, milOn: true, stored: ["P0301"], pending: [], trace: [{ t: 0, rpm: 800 }] } });
    expect(validateEngineSound(reply({ sounds: [] }), withObd)?.result.driveAdvice).toBe("stop");
  });

  it("drops OBD notes when no live data was sent", () => {
    expect(validateEngineSound(reply({ obdNotes: ["rpm hunts"] }), ctx())?.result.obdNotes).toEqual([]);
  });
});

describe("engineClipContext", () => {
  it("describes the car, concerns and the rpm trace", () => {
    const text = engineClipContext(
      ctx({
        description: "call me on 9876543210",
        obd: { simulated: true, milOn: false, stored: [], pending: ["P0301"], trace: [{ t: 0, rpm: 790, coolantTemp: 88 }, { t: 9, rpm: 3010, engineLoad: 41 }] },
      }),
    );
    expect(text).toContain("2019 Maruti Suzuki Swift petrol 1.2 L");
    expect(text).toContain("Ticking or tapping");
    expect(text).toContain("[number]");
    expect(text).not.toContain("9876543210");
    expect(text).toContain("SIMULATED");
    expect(text).toContain("P0301 (pending)");
    expect(text).toContain("t=9s: 3010 rpm, load 41%");
  });

  it("says when there is no adapter data", () => {
    expect(engineClipContext(ctx())).toContain("No OBD adapter was connected");
  });
});

describe("request and reply parsing", () => {
  it("rejects clip ids that could escape the folder", () => {
    expect(AnalyzeEngineClipRequest.safeParse({ clipId: "../../x", context: ctx() }).success).toBe(false);
    expect(AnalyzeEngineClipRequest.safeParse({ clipId: "0b6c3c4e-7d1a-4e7e-9a55-2f9b2f0d1c11", context: ctx() }).success).toBe(true);
  });

  it("parses JSON wrapped in a code fence", () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply("no json")).toBeNull();
  });
});
