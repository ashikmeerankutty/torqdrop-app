import { describe, expect, it } from "vitest";
import { Elm327, ObdCommandError, cleanReply } from "../lib/obd/elm327";
import { MockTransport } from "../lib/obd/mock-transport";
import { parseDtcReply, dtcFromBytes } from "../lib/obd/dtc-parser";
import {
  PIDS,
  decodeMonitorStatus,
  decodePid,
  decodeSupportedPids,
  evidenceLabel,
  mode01Payload,
  mode01Payloads,
} from "../lib/obd/pid-decoder";

describe("cleanReply", () => {
  it("drops echo, SEARCHING and prompt", () => {
    expect(cleanReply("010C\rSEARCHING...\r41 0C 1A F8 \r\r>", "010C")).toEqual(["41 0C 1A F8"]);
  });
});

describe("PID decoding", () => {
  it("decodes rpm", () => {
    const p = mode01Payload(["41 0C 1A F8"], 0x0c)!;
    expect(decodePid(PIDS.rpm, p)).toBe(1726);
  });
  it("decodes coolant and fuel trim", () => {
    expect(decodePid(PIDS.coolantTemp, mode01Payload(["41 05 7B"], 0x05)!)).toBe(83);
    expect(decodePid(PIDS.longFuelTrim1, [0x80])).toBe(0);
    expect(decodePid(PIDS.longFuelTrim1, [0x90])).toBe(12.5);
  });
  it("returns null when the reply is for a different PID", () => {
    expect(mode01Payload(["41 0D 30"], 0x0c)).toBeNull();
  });
  it("picks the matching line when several ECUs answer", () => {
    expect(mode01Payload(["41 0D 30", "41 0C 0F A0"], 0x0c)).toEqual([0x0f, 0xa0]);
  });
  it("decodes MIL and DTC count", () => {
    expect(decodeMonitorStatus([0x82, 0x07, 0xe5, 0x00])).toEqual({ milOn: true, dtcCount: 2 });
  });
  it("lists supported PIDs from the bitmap", () => {
    // BE 1F A8 13: PIDs 01,03,04,05,06,07 ... 0C, 0D etc.
    const sup = decodeSupportedPids(0x00, [0xbe, 0x1f, 0xa8, 0x13]);
    expect(sup).toContain(0x05);
    expect(sup).toContain(0x0c);
    expect(sup).not.toContain(0x02);
  });
});

describe("DTC parsing", () => {
  it("builds codes from bytes", () => {
    expect(dtcFromBytes(0x01, 0x33)).toBe("P0133");
    expect(dtcFromBytes(0x43, 0x00)).toBe("C0300");
    expect(dtcFromBytes(0xc1, 0x00)).toBe("U0100");
  });
  it("parses a CAN reply with count byte", () => {
    expect(parseDtcReply(["43 02 01 33 03 00"], 0x43, true)).toEqual(["P0133", "P0300"]);
  });
  it("skips padding on non-CAN replies", () => {
    expect(parseDtcReply(["43 01 33 00 00 00 00"], 0x43, false)).toEqual(["P0133"]);
  });
  it("returns nothing when no codes are stored", () => {
    expect(parseDtcReply(["43 00"], 0x43, true)).toEqual([]);
  });
  it("handles multi-frame replies", () => {
    const lines = ["00A", "0: 43 03 01 33", "1: 03 00 01 71"];
    expect(parseDtcReply(lines, 0x43, true)).toEqual(["P0133", "P0300", "P0171"]);
  });
});

describe("Elm327 driver", () => {
  const replies = {
    ATZ: "ELM327 v1.5",
    ATE0: "OK",
    ATL0: "OK",
    ATS0: "OK",
    ATH0: "OK",
    ATSP0: "OK",
    "010C": "41 0C 1A F8",
    "010D": "NO DATA",
    "0100": "UNABLE TO CONNECT",
  };

  it("runs the init sequence and reads a PID", async () => {
    const t = new MockTransport(replies);
    const elm = new Elm327(t);
    await elm.init();
    expect(t.written).toEqual(["ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"]);
    expect(await elm.send("010C")).toEqual(["41 0C 1A F8"]);
  });

  it("surfaces NO DATA as an error, not zero", async () => {
    const elm = new Elm327(new MockTransport(replies));
    await expect(elm.send("010D")).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("surfaces UNABLE TO CONNECT", async () => {
    const elm = new Elm327(new MockTransport(replies));
    await expect(elm.send("0100")).rejects.toBeInstanceOf(ObdCommandError);
  });

  it("times out when the adapter never answers, after one retry", async () => {
    const silent = new MockTransport({});
    silent.write = async (d) => void silent.written.push(d);
    const elm = new Elm327(silent, { timeoutMs: 20, retries: 1 });
    await expect(elm.send("010C")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(silent.written).toHaveLength(2);
  });

  it("serialises concurrent commands", async () => {
    const t = new MockTransport(replies);
    const elm = new Elm327(t);
    const [a, b] = await Promise.all([elm.send("010C"), elm.send("010D").catch(() => ["err"])]);
    expect(a).toEqual(["41 0C 1A F8"]);
    expect(b).toEqual(["err"]);
    expect(t.written).toEqual(["010C", "010D"]);
  });
});

describe("multi-ECU replies", () => {
  it("returns every ECU's payload for the PID", () => {
    expect(mode01Payloads(["41 00 98 18 00 13", "41 00 BE 3E B8 13"], 0x00)).toEqual([
      [0x98, 0x18, 0x00, 0x13],
      [0xbe, 0x3e, 0xb8, 0x13],
    ]);
  });

  it("labels evidence refs in plain words", () => {
    expect(evidenceLabel("mil")).toBe("Check-engine light");
    expect(evidenceLabel("coolantTemp")).toBe("Coolant temperature");
    expect(evidenceLabel("P0301")).toBe("P0301");
  });
});
