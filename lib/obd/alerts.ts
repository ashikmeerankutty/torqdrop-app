import * as Haptics from "expo-haptics";
import { useSyncExternalStore } from "react";

import { getCarSettings } from "@/lib/car-settings";

import { live } from "./live";
import { getMetricsVehicle, redlineRpm } from "./metrics";

import { type DriveAlert, evaluateAlerts } from "./alert-rules";

export type { DriveAlert } from "./alert-rules";

let active: DriveAlert[] = [];
const listeners = new Set<() => void>();

export function useDriveAlerts(): DriveAlert[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => active,
  );
}

/** Watches live values once a second while connected. New alerts buzz the phone. */
export function startAlerts(getMil: () => boolean = () => false): () => void {
  let milWasOn: boolean | null = null;
  let milAlertUntil = 0;
  const timer = setInterval(() => {
    const s = getCarSettings();
    if (!s.alerts.enabled) {
      if (active.length) {
        active = [];
        listeners.forEach((l) => l());
      }
      return;
    }
    const milOn = getMil();
    const vehicle = getMetricsVehicle();
    const now = Date.now();
    const found = evaluateAlerts(
      {
        coolant: live.get("coolantTemp"),
        voltage: live.get("moduleVoltage") ?? live.get("batteryVoltage"),
        speed: live.get("speed"),
        rpm: live.get("rpm"),
        milOn,
        // The first reading after connecting isn't "came on".
        milWasOn: milWasOn ?? milOn,
      },
      { coolantC: s.alerts.coolantC, lowVoltage: s.alerts.lowVoltage, overspeedKmh: s.alerts.overspeedKmh, redline: redlineRpm(vehicle) },
    );
    if (found.some((a) => a.id === "mil")) milAlertUntil = now + 60_000;
    milWasOn = milOn;
    const next: DriveAlert[] = found.map((a) => active.find((x) => x.id === a.id) ?? { ...a, since: now });
    // Keep the check-engine alert up for a minute; it only fires on the change.
    const mil = active.find((x) => x.id === "mil");
    if (mil && now < milAlertUntil && !next.some((x) => x.id === "mil")) next.push(mil);
    const fresh = next.filter((a) => !active.some((x) => x.id === a.id));
    if (fresh.length && s.alerts.vibrate) {
      void Haptics.notificationAsync(fresh.some((a) => a.severity === "danger") ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    if (fresh.length || next.length !== active.length || next.some((a, i) => a.title !== active[i]?.title)) {
      active = next;
      listeners.forEach((l) => l());
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    active = [];
    listeners.forEach((l) => l());
  };
}
