export type Grade = "good" | "attention" | "defect";

export interface BatteryResult {
  resting: number | null;
  crankMin: number | null;
  idle: number | null;
  loaded: number | null;
}

export interface GradedLine {
  key: keyof BatteryResult;
  label: string;
  value: number | null;
  grade: Grade | null;
  note: string;
}

/** Standard 12 V lead-acid thresholds. */
export function gradeBattery(r: BatteryResult): GradedLine[] {
  const resting = (v: number): [Grade, string] =>
    v >= 12.6
      ? ["good", "Fully charged."]
      : v >= 12.4
        ? ["good", "About three-quarters charged."]
        : v >= 12.2
          ? ["attention", "About half charged. A long drive or a charger will top it up."]
          : ["defect", "Low. The battery is flat or near the end of its life."];
  const crank = (v: number): [Grade, string] =>
    v >= 10
      ? ["good", "Strong cranking."]
      : v >= 9.6
        ? ["attention", "Weak cranking. Fine in warm weather; may struggle on cold mornings."]
        : ["defect", "Very weak cranking. The battery may soon fail to start the car."];
  const idle = (v: number): [Grade, string] =>
    v > 15
      ? ["defect", "Too high. The regulator may be overcharging and damaging the battery."]
      : v >= 13.5
        ? ["good", "The alternator is charging."]
        : v >= 13.2
          ? ["attention", "On the low side. Some smart-charging cars do this; recheck after a drive."]
          : ["defect", "Not charging properly. Have the alternator and belt checked."];
  const loaded = (v: number): [Grade, string] =>
    v >= 13.2
      ? ["good", "Holds up under electrical load."]
      : v >= 12.8
        ? ["attention", "Drops under load. The alternator may be weak."]
        : ["defect", "Can't keep up with the load. The battery is draining while you drive."];
  const line = (key: keyof BatteryResult, label: string, f: (v: number) => [Grade, string]): GradedLine => {
    const v = r[key];
    if (v == null) return { key, label, value: null, grade: null, note: "Not measured." };
    const [grade, note] = f(v);
    return { key, label, value: v, grade, note };
  };
  return [
    line("resting", "Resting (engine off)", resting),
    line("crankMin", "Lowest while cranking", crank),
    line("idle", "Charging at idle", idle),
    line("loaded", "Charging with lights and AC on", loaded),
  ];
}
