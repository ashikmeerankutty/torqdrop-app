import { describe, expect, it } from "vitest";
import { describeDtc } from "../lib/diagnostics/dtc-database";
import { evaluateSafety } from "../lib/diagnostics/safety-rules";
import { ObdCommandError } from "../lib/obd/elm327";
import { MockTransport } from "../lib/obd/mock-transport";
import { decodeSupportedPids } from "../lib/obd/pid-decoder";
import { ObdSession } from "../lib/obd/session";
import { createSimulatedCar, supportedBitmap } from "../lib/obd/simulated-car";

describe("supportedBitmap", () => {
  it("round-trips through decodeSupportedPids", () => {
    const pids = [0x01, 0x05, 0x0c, 0x0d, 0x20];
    expect(decodeSupportedPids(0x00, supportedBitmap(0x00, pids))).toEqual(pids);
  });
});

describe("ObdSession on the simulated car", () => {
  const open = (now = () => 0) => ObdSession.open(new MockTransport(createSimulatedCar(now)));

  it("discovers the protocol and supported PIDs across bitmaps", async () => {
    const s = await open();
    expect(s.simulated).toBe(true);
    expect(s.protocol).toBe("6");
    expect(s.canFramed).toBe(true);
    expect(s.isSupported("rpm")).toBe(true);
    expect(s.isSupported("moduleVoltage")).toBe(true);
    expect(s.isSupported("maf")).toBe(false);
  });

  it("reads values, and null (not zero) for an unsupported PID", async () => {
    let t = 0;
    const s = await open(() => t);
    expect(await s.readPid("coolantTemp")).toBe(35);
    expect(await s.readPid("speed")).toBe(0);
    expect(await s.readPid("maf")).toBeNull();
    t = 21_000; // mid-acceleration, in third gear
    expect(await s.readPid("speed")).toBe(65);
    expect(await s.readPid("rpm")).toBeCloseTo(3145, -1);
    expect(await s.readPid("moduleVoltage")).toBeCloseTo(14.1, 0);
  });

  it("reads MIL, stored and pending codes, and clears them", async () => {
    const s = await open();
    expect(await s.readMonitorStatus()).toEqual({ milOn: true, dtcCount: 1 });
    expect(await s.readDtcs()).toEqual({ stored: ["P0171"], pending: ["P0301"] });
    await s.clearDtcs();
    expect(await s.readDtcs()).toEqual({ stored: [], pending: [] });
    expect(await s.readMonitorStatus()).toEqual({ milOn: false, dtcCount: 0 });
  });

  it("treats NO DATA on a code read as no codes", async () => {
    const replies: Record<string, string> = { ATZ: "ELM327 v1.5", "0100": "41 00 80 00 00 00", ATDPN: "A6", "03": "NO DATA", "07": "NO DATA" };
    for (const c of ["ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"]) replies[c] = "OK";
    const s = await ObdSession.open(new MockTransport(replies));
    expect(await s.readDtcs()).toEqual({ stored: [], pending: [] });
  });

  it("fails to open with UNABLE_TO_CONNECT when the ignition is off", async () => {
    const replies: Record<string, string> = { ATZ: "ELM327 v1.5", "0100": "UNABLE TO CONNECT" };
    for (const c of ["ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"]) replies[c] = "OK";
    await expect(ObdSession.open(new MockTransport(replies))).rejects.toMatchObject({ code: "UNABLE_TO_CONNECT" });
    await expect(ObdSession.open(new MockTransport(replies))).rejects.toBeInstanceOf(ObdCommandError);
  });
});

describe("evaluateSafety", () => {
  it("flags misfire codes as urgent and doesn't double up with the MIL banner", () => {
    const b = evaluateSafety({ milOn: true, stored: ["P0171"], pending: ["P0301"] });
    expect(b.map((x) => x.id)).toEqual(["misfire"]);
    expect(b[0]).toMatchObject({ severity: "urgent", refs: ["P0301"] });
  });

  it("grades coolant temperature and ignores an unsupported sensor", () => {
    expect(evaluateSafety({ milOn: false, stored: [], pending: [], coolantTemp: 92 })).toEqual([]);
    expect(evaluateSafety({ milOn: false, stored: [], pending: [], coolantTemp: 108 })[0].id).toBe("coolant_high");
    expect(evaluateSafety({ milOn: false, stored: [], pending: [], coolantTemp: 118 })[0]).toMatchObject({
      id: "overheating",
      severity: "urgent",
    });
    expect(evaluateSafety({ milOn: false, stored: [], pending: [], coolantTemp: null })).toEqual([]);
  });

  it("raises a MIL banner without a misfire", () => {
    expect(evaluateSafety({ milOn: true, stored: ["P0420"], pending: [] })[0]).toMatchObject({ id: "mil", severity: "attention" });
  });
});

describe("describeDtc", () => {
  it("describes generic codes, including each cylinder misfire", () => {
    expect(describeDtc("p0171")).toMatchObject({ code: "P0171", known: true, title: "Fuel mixture too lean (bank 1)" });
    expect(describeDtc("P0304").title).toBe("Cylinder 4 misfire");
  });

  it("labels manufacturer-specific and unknown codes honestly", () => {
    expect(describeDtc("P1456")).toMatchObject({ known: false, manufacturerSpecific: true });
    expect(describeDtc("U0100")).toMatchObject({ known: false, manufacturerSpecific: false, title: "Network code (no description available)" });
  });
});
