/**
 * Plain-language titles for common generic (SAE J2012) trouble codes. A code says which check the
 * engine computer failed, not which part is broken, so these never name a failed component.
 */
const GENERIC: Record<string, string> = {
  P0101: "Mass air flow sensor reading out of range",
  P0102: "Mass air flow sensor signal low",
  P0103: "Mass air flow sensor signal high",
  P0106: "Manifold pressure sensor reading out of range",
  P0110: "Intake air temperature sensor circuit",
  P0113: "Intake air temperature sensor signal high",
  P0115: "Coolant temperature sensor circuit",
  P0117: "Coolant temperature sensor signal low",
  P0118: "Coolant temperature sensor signal high",
  P0120: "Throttle position sensor circuit",
  P0121: "Throttle position sensor reading out of range",
  P0122: "Throttle position sensor signal low",
  P0125: "Engine slow to reach temperature for closed-loop fuel control",
  P0128: "Coolant below thermostat regulating temperature",
  P0130: "Oxygen sensor circuit (bank 1, sensor 1)",
  P0131: "Oxygen sensor signal low (bank 1, sensor 1)",
  P0133: "Oxygen sensor slow response (bank 1, sensor 1)",
  P0135: "Oxygen sensor heater circuit (bank 1, sensor 1)",
  P0141: "Oxygen sensor heater circuit (bank 1, sensor 2)",
  P0171: "Fuel mixture too lean (bank 1)",
  P0172: "Fuel mixture too rich (bank 1)",
  P0174: "Fuel mixture too lean (bank 2)",
  P0175: "Fuel mixture too rich (bank 2)",
  P0300: "Random or multiple cylinder misfire",
  P0325: "Knock sensor circuit (bank 1)",
  P0335: "Crankshaft position sensor circuit",
  P0340: "Camshaft position sensor circuit (bank 1)",
  P0401: "Exhaust gas recirculation flow too low",
  P0402: "Exhaust gas recirculation flow too high",
  P0420: "Catalytic converter efficiency below threshold (bank 1)",
  P0430: "Catalytic converter efficiency below threshold (bank 2)",
  P0440: "Evaporative emission system fault",
  P0442: "Evaporative emission system small leak",
  P0455: "Evaporative emission system large leak",
  P0456: "Evaporative emission system very small leak",
  P0500: "Vehicle speed sensor",
  P0505: "Idle air control system",
  P0506: "Idle speed lower than expected",
  P0507: "Idle speed higher than expected",
  P0562: "System voltage low",
  P0563: "System voltage high",
  P0700: "Transmission control system fault (read the transmission module for details)",
};

const SYSTEMS: Record<string, string> = { P: "Powertrain", C: "Chassis", B: "Body", U: "Network" };

export interface DtcInfo {
  code: string;
  title: string;
  /** True for generic codes we have a title for. */
  known: boolean;
  /** Second character 1 (and P3xxx) codes are defined by each manufacturer. */
  manufacturerSpecific: boolean;
}

export function describeDtc(code: string): DtcInfo {
  const upper = code.toUpperCase();
  const cylinder = /^P030([1-8])$/.exec(upper);
  const title = GENERIC[upper] ?? (cylinder ? `Cylinder ${cylinder[1]} misfire` : undefined);
  const manufacturerSpecific = upper[1] === "1" || (upper[0] === "P" && upper[1] === "3");
  if (title) return { code: upper, title, known: true, manufacturerSpecific: false };
  const system = SYSTEMS[upper[0]] ?? "Unknown system";
  return {
    code: upper,
    title: manufacturerSpecific
      ? `${system} code defined by the manufacturer`
      : `${system} code (no description available)`,
    known: false,
    manufacturerSpecific,
  };
}
