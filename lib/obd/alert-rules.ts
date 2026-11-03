export interface DriveAlert {
  id: "coolant" | "voltage" | "overspeed" | "overrev" | "mil";
  severity: "warning" | "danger";
  title: string;
  body: string;
  since: number;
}

export interface AlertInput {
  coolant: number | null | undefined;
  voltage: number | null | undefined;
  speed: number | null | undefined;
  rpm: number | null | undefined;
  milOn: boolean;
  milWasOn: boolean;
}

export interface AlertLimits {
  coolantC: number;
  lowVoltage: number;
  overspeedKmh: number;
  redline: number;
}

const num = (v: number | null | undefined): v is number => typeof v === "number";

/** Which alerts apply right now. Pure, so it can be tested. */
export function evaluateAlerts(i: AlertInput, l: AlertLimits): Omit<DriveAlert, "since">[] {
  const out: Omit<DriveAlert, "since">[] = [];
  if (num(i.coolant) && i.coolant >= l.coolantC) {
    out.push({
      id: "coolant",
      severity: i.coolant >= l.coolantC + 7 ? "danger" : "warning",
      title: `Engine hot: ${Math.round(i.coolant)} °C`,
      body: "Ease off. If it keeps rising, pull over safely and switch off. Don't open the radiator cap while hot.",
    });
  }
  // Only with the engine running: a parked car sits at battery voltage.
  if (num(i.voltage) && num(i.rpm) && i.rpm > 600 && i.voltage < l.lowVoltage) {
    out.push({
      id: "voltage",
      severity: "warning",
      title: `Low charging voltage: ${i.voltage.toFixed(1)} V`,
      body: "The alternator may not be charging the battery. Avoid switching the engine off far from help.",
    });
  }
  if (l.overspeedKmh > 0 && num(i.speed) && i.speed > l.overspeedKmh) {
    out.push({ id: "overspeed", severity: "warning", title: `Over ${l.overspeedKmh} km/h`, body: "You set this speed alert." });
  }
  if (num(i.rpm) && i.rpm > l.redline) {
    out.push({ id: "overrev", severity: "warning", title: "Near the redline", body: `Engine speed above ${l.redline} rpm.` });
  }
  if (i.milOn && !i.milWasOn) {
    out.push({
      id: "mil",
      severity: "danger",
      title: "Check-engine light came on",
      body: "A fault was just recorded. If the light flashes or the car runs badly, slow down and get it checked.",
    });
  }
  return out;
}
