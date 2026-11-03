// Live check of analyzeLive against the real Meta API, using a made-up snapshot.
// Usage: META_API_KEY=LLM_... npx tsx scripts/analyze-live-smoke.ts
import { analyzeLive } from "../functions/src/analyze-live";
import { MetaClient } from "../functions/src/shared/meta-client";
import { SnapshotBuilder } from "../lib/obd/snapshot-builder";

const key = process.env.META_API_KEY;
if (!key) {
  console.error("Set META_API_KEY");
  process.exit(1);
}

let t = Date.now() - 30_000;
const b = new SnapshotBuilder({ windowSeconds: 30, simulated: true }, () => t);
for (let i = 0; i < 30; i++, t += 1000) {
  b.addReading("rpm", "rpm", 780 + Math.round(Math.random() * 60));
  b.addReading("coolantTemp", "°C", 88 + (i > 20 ? 4 : 0));
  b.addReading("longFuelTrim1", "%", 14 + Math.random() * 2);
}
b.markUnsupported("shortFuelTrim1");
b.setMil(true, 1);
b.setDtcs(["P0171"], []);

const snapshot = b.build("new_dtc");

async function main() {
  const result = await analyzeLive(snapshot, new MetaClient({ apiKey: key! }));
  console.log(JSON.stringify(result, null, 2));
  const cost = result.usage.reduce((s, u) => s + u.costUsd, 0);
  console.log(`\ncalls: ${result.usage.length}  total cost: $${cost.toFixed(5)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
