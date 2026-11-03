/** Health readings saved with each trip, compared over weeks to spot slow decline. */
export interface TripStats {
  /** Average voltage with the engine running: the charging system. */
  runningVoltage: number | null;
  minRunningVoltage: number | null;
  /** Seconds from a cold start to 80 °C coolant. */
  warmupS: number | null;
  /** Average fuel trims with a warm engine. */
  ltft: number | null;
  stft: number | null;
  maxCoolant: number | null;
  /** Average warm idle speed. */
  idleRpm: number | null;
}

export interface ScoreInput {
  distanceKm: number;
  durationS: number;
  movingS: number;
  idleS: number;
  harshAccel: number;
  harshBrake: number;
  highRev: number;
}

/**
 * Drive score out of 100. Harsh events are counted per 10 km so a long smooth drive with one hard
 * stop isn't punished like a short jerky one. Idling over a third of the time also costs points.
 */
export function scoreTrip(t: ScoreInput): number {
  const per10km = 10 / Math.max(t.distanceKm, 3);
  const events = (t.harshAccel * 4 + t.harshBrake * 5 + t.highRev * 2) * per10km;
  const idleShare = t.durationS > 0 ? t.idleS / t.durationS : 0;
  const idle = Math.max(0, idleShare - 0.33) * 40;
  return Math.max(0, Math.min(100, Math.round(100 - events - idle)));
}

/** Fuel economy in the person's unit. */
export function economy(distanceKm: number, fuelL: number | null, unit: "kmpl" | "l100km"): { value: number; unit: string } | null {
  if (fuelL == null || fuelL <= 0.01 || distanceKm < 0.1) return null;
  return unit === "kmpl" ? { value: distanceKm / fuelL, unit: "km/L" } : { value: (fuelL / distanceKm) * 100, unit: "L/100 km" };
}

export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export interface TrendFlag {
  key: keyof TripStats;
  title: string;
  body: string;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Compare the latest trips with the car's earlier ones. Needs at least 8 trips with the reading.
 * Flags are hints to get something checked, never a diagnosis.
 */
export function trendFlags(statsOldestFirst: TripStats[]): TrendFlag[] {
  const flags: TrendFlag[] = [];
  const series = (k: keyof TripStats) => statsOldestFirst.map((s) => s[k]).filter((v): v is number => typeof v === "number");
  const split = (xs: number[]) => {
    const recent = xs.slice(-3);
    const before = xs.slice(0, -3);
    return { recent: mean(recent), before: mean(before) };
  };

  const volt = series("runningVoltage");
  if (volt.length >= 8) {
    const { recent, before } = split(volt);
    if (recent < 13.2 && before - recent > 0.3) {
      flags.push({
        key: "runningVoltage",
        title: "Charging voltage dropping",
        body: `Running voltage averaged ${recent.toFixed(1)} V on recent drives, down from ${before.toFixed(1)} V. Have the alternator and battery tested.`,
      });
    }
  }
  const ltft = series("ltft");
  if (ltft.length >= 8) {
    const { recent, before } = split(ltft);
    if (Math.abs(recent) > 8 && Math.abs(recent - before) > 4) {
      flags.push({
        key: "ltft",
        title: recent > 0 ? "Engine running leaner over time" : "Engine running richer over time",
        body: `Long-term fuel trim moved from ${before.toFixed(1)} % to ${recent.toFixed(1)} %. ${recent > 0 ? "Common causes are a vacuum leak, a dirty MAF sensor or a weak fuel pump." : "Common causes are a leaking injector, a stuck purge valve or a faulty oxygen sensor."}`,
      });
    }
  }
  const warm = series("warmupS");
  if (warm.length >= 5) {
    const recent = mean(warm.slice(-2));
    const before = mean(warm.slice(0, -2));
    if (recent > before * 1.6 && recent - before > 180) {
      flags.push({
        key: "warmupS",
        title: "Engine taking longer to warm up",
        body: `Recent cold starts took about ${Math.round(recent / 60)} min to reach 80 °C, against ${Math.round(before / 60)} min before. A thermostat stuck open is the usual cause.`,
      });
    }
  }
  const coolant = series("maxCoolant");
  if (coolant.length >= 8) {
    const { recent, before } = split(coolant);
    if (recent - before > 6 && recent > 100) {
      flags.push({
        key: "maxCoolant",
        title: "Engine running hotter",
        body: `Peak coolant temperature rose from about ${Math.round(before)} °C to ${Math.round(recent)} °C. Check the coolant level, radiator fan and thermostat.`,
      });
    }
  }
  const idle = series("idleRpm");
  if (idle.length >= 8) {
    const { recent, before } = split(idle);
    if (Math.abs(recent - before) > 150) {
      flags.push({
        key: "idleRpm",
        title: "Idle speed has changed",
        body: `Warm idle moved from about ${Math.round(before)} rpm to ${Math.round(recent)} rpm. A dirty throttle body or a vacuum leak can do this.`,
      });
    }
  }
  return flags;
}
