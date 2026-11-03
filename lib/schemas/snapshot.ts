import { z } from "zod";

/** Summary of one PID over the snapshot window. Only supported PIDs appear here. */
export const PidStats = z.object({
  unit: z.string(),
  last: z.number(),
  min: z.number(),
  avg: z.number(),
  max: z.number(),
  samples: z.number().int().positive(),
});

/**
 * Normalised telemetry sent to the AI. Raw streams are never sent: the app summarises
 * the last `windowSeconds` of readings into this shape.
 */
export const LiveSnapshot = z.object({
  capturedAt: z.string().datetime(),
  windowSeconds: z.number().positive(),
  /** True when the data came from MockTransport. Results must be labelled "Simulated". */
  simulated: z.boolean(),
  mil: z.object({ on: z.boolean(), dtcCount: z.number().int().min(0) }),
  dtcs: z.object({ stored: z.array(z.string()), pending: z.array(z.string()) }),
  freezeFrame: z.record(z.string(), z.number()).optional(),
  pids: z.record(z.string(), PidStats),
  /** PIDs the vehicle did not report. Shown as "not supported", never as zero. */
  unsupportedPids: z.array(z.string()),
  /** What triggered this snapshot, e.g. "interval", "new_dtc", "mil_on", "coolant_high". */
  trigger: z.string(),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshot>;

/** Every reference an insight card may cite: PID keys, DTC codes, and "mil". */
export function snapshotRefs(s: LiveSnapshot): Set<string> {
  return new Set([...Object.keys(s.pids), ...s.dtcs.stored, ...s.dtcs.pending, "mil"]);
}
