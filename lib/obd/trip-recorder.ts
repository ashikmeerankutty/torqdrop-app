import * as Location from "expo-location";
import { useSyncExternalStore } from "react";

import { getCarSettings } from "@/lib/car-settings";
import { getDb, notify } from "@/lib/db";

import { live } from "./live";
import { fuelFlowLph, getMetricsVehicle, redlineRpm } from "./metrics";
import { scoreTrip, type TripStats } from "./trip-stats";

export interface LiveTrip {
  tripId: number;
  startedAt: number;
  distanceKm: number;
  durationS: number;
  idleS: number;
  fuelL: number | null;
  maxSpeed: number;
  harshAccel: number;
  harshBrake: number;
  highRev: number;
}

interface Sample {
  t: number;
  lat: number | null;
  lon: number | null;
  speed: number | null;
  rpm: number | null;
  throttle: number | null;
  fuelLph: number | null;
  coolant: number | null;
}

/** Harsh events, in m/s² over one second of OBD speed. */
const HARSH_ACCEL = 3.0;
const HARSH_BRAKE = -3.5;
/** A trip ends after this long stopped with the engine off, or this long stopped at all. */
const END_ENGINE_OFF_MS = 30_000;
const END_STOPPED_MS = 10 * 60_000;
const MIN_TRIP_KM = 0.2;

let current: LiveTrip | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useLiveTrip(): LiveTrip | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Records a trip whenever the connected car moves, while the app is open. Samples once a second;
 * GPS is added when the person has already allowed location (the Trips screen asks for it).
 */
export function startTripRecorder(simulated: boolean): () => void {
  if (!getCarSettings().autoTrips) return () => {};
  let tripId: number | null = null;
  let pending: Sample[] = [];
  let lastTick = 0;
  let stoppedSince: number | null = null;
  let engineOffSince: number | null = null;
  let prevSpeed: number | null = null;
  let lastHarshAt = 0;
  let lastHighRevAt = 0;
  let gps: Location.LocationObject | null = null;
  let gpsSub: Location.LocationSubscription | null = null;
  let stats: RunningStats = emptyStats();
  let closing = false;

  async function startGps() {
    if (!getCarSettings().tripGps) return;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      gpsSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 }, (loc) => {
        gps = loc;
      });
    } catch (e) {
      console.warn("trip GPS unavailable", e);
    }
  }

  async function begin(now: number) {
    const db = await getDb();
    const vehicle = getMetricsVehicle();
    const r = await db.runAsync(
      "INSERT INTO trips (vehicleId, startedAt, endedAt, distanceKm, durationS, movingS, idleS, maxSpeed, simulated) VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?)",
      simulated ? null : (vehicle?.id ?? null),
      now,
      now,
      simulated ? 1 : 0,
    );
    tripId = r.lastInsertRowId;
    stats = emptyStats();
    stats.startCoolant = live.get("coolantTemp") ?? null;
    current = { tripId, startedAt: now, distanceKm: 0, durationS: 0, idleS: 0, fuelL: null, maxSpeed: 0, harshAccel: 0, harshBrake: 0, highRev: 0 };
    void startGps();
    emit();
  }

  async function flushSamples() {
    if (!tripId || !pending.length) return;
    const batch = pending;
    pending = [];
    const db = await getDb();
    const stmt = await db.prepareAsync(
      "INSERT INTO trip_samples (tripId, t, lat, lon, speed, rpm, throttle, fuelLph, coolant) VALUES ($tripId, $t, $lat, $lon, $speed, $rpm, $throttle, $fuelLph, $coolant)",
    );
    try {
      await db.withTransactionAsync(async () => {
        for (const s of batch) {
          await stmt.executeAsync({
            $tripId: tripId,
            $t: s.t,
            $lat: s.lat,
            $lon: s.lon,
            $speed: s.speed,
            $rpm: s.rpm,
            $throttle: s.throttle,
            $fuelLph: s.fuelLph,
            $coolant: s.coolant,
          });
        }
      });
    } finally {
      await stmt.finalizeAsync();
    }
  }

  async function finish() {
    if (!tripId || !current || closing) return;
    closing = true;
    const trip = current;
    const id = tripId;
    gpsSub?.remove();
    gpsSub = null;
    gps = null;
    try {
      await flushSamples();
      const db = await getDb();
      if (trip.distanceKm < MIN_TRIP_KM) {
        await db.runAsync("DELETE FROM trip_samples WHERE tripId = ?", id);
        await db.runAsync("DELETE FROM trips WHERE id = ?", id);
      } else {
        const movingS = trip.durationS - trip.idleS;
        const score = scoreTrip({ ...trip, movingS });
        await db.runAsync(
          `UPDATE trips SET endedAt = ?, distanceKm = ?, durationS = ?, movingS = ?, idleS = ?, maxSpeed = ?, fuelL = ?, fuelEstimated = ?,
           harshAccel = ?, harshBrake = ?, highRev = ?, score = ?, stats = ? WHERE id = ?`,
          trip.startedAt + trip.durationS * 1000,
          trip.distanceKm,
          trip.durationS,
          movingS,
          trip.idleS,
          trip.maxSpeed,
          trip.fuelL,
          live.get("fuelRate") != null ? 0 : 1,
          trip.harshAccel,
          trip.harshBrake,
          trip.highRev,
          score,
          JSON.stringify(finalStats(stats)),
          id,
        );
      }
      notify("trips");
    } catch (e) {
      console.warn("trip not saved", e);
    } finally {
      tripId = null;
      current = null;
      closing = false;
      emit();
    }
  }

  function tick() {
    const now = Date.now();
    const dt = lastTick ? Math.min(5, (now - lastTick) / 1000) : 1;
    lastTick = now;
    const speed = live.get("speed");
    const rpm = live.get("rpm");
    const moving = num(speed) && speed > 0;
    const engineOn = !num(rpm) || rpm > 300;

    if (!tripId) {
      if (moving && !closing) void begin(now);
      prevSpeed = num(speed) ? speed : null;
      return;
    }
    if (!current) return;

    // End conditions.
    stoppedSince = moving ? null : (stoppedSince ?? now);
    engineOffSince = engineOn ? null : (engineOffSince ?? now);
    if ((engineOffSince && now - engineOffSince > END_ENGINE_OFF_MS) || (stoppedSince && now - stoppedSince > END_STOPPED_MS)) {
      void finish();
      return;
    }

    const vehicle = getMetricsVehicle();
    const lph = fuelFlowLph((k) => live.get(k), vehicle);
    const t = { ...current };
    t.durationS += dt;
    if (num(speed)) {
      t.distanceKm += (speed * dt) / 3600;
      t.maxSpeed = Math.max(t.maxSpeed, speed);
      if (speed === 0 && engineOn) t.idleS += dt;
      if (prevSpeed != null && now - lastHarshAt > 3000) {
        const a = (speed - prevSpeed) / 3.6 / dt;
        if (a > HARSH_ACCEL) [t.harshAccel, lastHarshAt] = [t.harshAccel + 1, now];
        else if (a < HARSH_BRAKE) [t.harshBrake, lastHarshAt] = [t.harshBrake + 1, now];
      }
      prevSpeed = speed;
    }
    if (lph != null) t.fuelL = (t.fuelL ?? 0) + (lph * dt) / 3600;
    if (num(rpm) && rpm > redlineRpm(vehicle) * 0.85 && now - lastHighRevAt > 5000) {
      t.highRev++;
      lastHighRevAt = now;
    }
    current = t;
    accumulate(stats, t.durationS);

    const coords = gps?.coords;
    pending.push({
      t: now,
      lat: coords?.latitude ?? null,
      lon: coords?.longitude ?? null,
      speed: num(speed) ? speed : null,
      rpm: num(rpm) ? rpm : null,
      throttle: live.get("throttle") ?? null,
      fuelLph: lph,
      coolant: live.get("coolantTemp") ?? null,
    });
    if (pending.length >= 30) void flushSamples().catch((e) => console.warn("trip samples not saved", e));
    emit();
  }

  const timer = setInterval(tick, 1000);
  return () => {
    clearInterval(timer);
    void finish();
  };
}

// ---- Health statistics kept per trip, for long-term trends ----

interface RunningStats {
  startCoolant: number | null;
  warmupS: number | null;
  voltSum: number;
  voltN: number;
  voltMin: number | null;
  ltftSum: number;
  ltftN: number;
  stftSum: number;
  stftN: number;
  maxCoolant: number | null;
  idleRpmSum: number;
  idleRpmN: number;
}

function emptyStats(): RunningStats {
  return { startCoolant: null, warmupS: null, voltSum: 0, voltN: 0, voltMin: null, ltftSum: 0, ltftN: 0, stftSum: 0, stftN: 0, maxCoolant: null, idleRpmSum: 0, idleRpmN: 0 };
}

function accumulate(s: RunningStats, elapsedS: number) {
  const [coolant, rpm, speed] = [live.get("coolantTemp"), live.get("rpm"), live.get("speed")];
  const volt = live.get("moduleVoltage") ?? live.get("batteryVoltage");
  if (num(coolant)) {
    s.maxCoolant = Math.max(s.maxCoolant ?? coolant, coolant);
    // Warm-up time only means something from a cold start.
    if (s.warmupS == null && num(s.startCoolant) && s.startCoolant < 50 && coolant >= 80) s.warmupS = elapsedS;
  }
  if (num(volt) && num(rpm) && rpm > 500) {
    s.voltSum += volt;
    s.voltN++;
    s.voltMin = Math.min(s.voltMin ?? volt, volt);
  }
  // Fuel trims and idle speed are only comparable with a warm engine.
  if (num(coolant) && coolant >= 75) {
    const [ltft, stft] = [live.get("longFuelTrim1"), live.get("shortFuelTrim1")];
    if (num(ltft)) [s.ltftSum, s.ltftN] = [s.ltftSum + ltft, s.ltftN + 1];
    if (num(stft)) [s.stftSum, s.stftN] = [s.stftSum + stft, s.stftN + 1];
    if (num(rpm) && num(speed) && speed === 0 && rpm > 400) [s.idleRpmSum, s.idleRpmN] = [s.idleRpmSum + rpm, s.idleRpmN + 1];
  }
}

function finalStats(s: RunningStats): TripStats {
  const avg = (sum: number, n: number) => (n ? Math.round((sum / n) * 100) / 100 : null);
  return {
    runningVoltage: avg(s.voltSum, s.voltN),
    minRunningVoltage: s.voltMin,
    warmupS: s.warmupS,
    ltft: avg(s.ltftSum, s.ltftN),
    stft: avg(s.stftSum, s.stftN),
    maxCoolant: s.maxCoolant,
    idleRpm: avg(s.idleRpmSum, s.idleRpmN),
  };
}
