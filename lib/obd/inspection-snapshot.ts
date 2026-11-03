import type { EcuExtended } from "@/lib/diagnostics/evidence-engine";

import { getObdState, readNow, readPermanentCodes } from "./connection";
import { tamperFlags } from "./health";
import type { LiveKey } from "./live";

/**
 * Everything beyond codes that a buyer's inspection wants from the car: VIN, ECU odometer, how long
 * since codes were cleared, readiness, permanent codes, and the resulting "ask the seller" flags.
 * Each read is optional; a car that doesn't report something just leaves it null.
 */
export async function readEcuExtended(): Promise<EcuExtended> {
  const state = getObdState();
  const supported = new Set<LiveKey>(state.supportedKeys);
  const read = async (k: LiveKey) => (supported.has(k) ? await readNow(k).catch(() => null) : null);
  const [odometerKm, distanceSinceClearKm, warmUpsSinceClear, timeSinceClear, distanceWithMilKm] = [
    await read("odometer"),
    await read("distanceSinceClear"),
    await read("warmUpsSinceClear"),
    await read("timeSinceClear"),
    await read("distanceWithMil"),
  ];
  const permanent = await readPermanentCodes().catch(() => [] as string[]);
  const readiness = getObdState().readiness ?? null;
  const flags = tamperFlags({
    readiness,
    distanceSinceClear: distanceSinceClearKm,
    warmUpsSinceClear,
    timeSinceClear,
    distanceWithMil: distanceWithMilKm,
  });
  return {
    vin: state.info?.vin ?? null,
    odometerKm,
    distanceSinceClearKm,
    warmUpsSinceClear,
    distanceWithMilKm,
    permanent,
    monitors: readiness?.monitors.map((m) => ({ name: m.name, complete: m.complete })) ?? [],
    flags: flags.map((f) => ({ id: f.id, title: f.title, body: f.body })),
  };
}
