// Phase 0 smoke test for the Meta Model API.
// Usage: META_API_KEY=LLM_... node scripts/meta-smoke.mjs path/to/photo.jpg
// Sends one photo to muse-spark-1.3 with a JSON schema and prints the result,
// token usage and estimated cost. Dev photos only: free credits may be used for training.
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.meta.ai/v1";
const MODEL = "muse-spark-1.3";
const PRICE_PER_M = { input: 1.25, output: 4.25 };

const key = process.env.META_API_KEY;
const file = process.argv[2];
if (!key || !file) {
  console.error("Usage: META_API_KEY=LLM_... node scripts/meta-smoke.mjs <photo.jpg>");
  process.exit(1);
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const mime = MIME[path.extname(file).toLowerCase()];
if (!mime) {
  console.error("Photo must be .jpg, .png or .webp");
  process.exit(1);
}
const b64 = (await readFile(file)).toString("base64");

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    observation: { type: "string" },
    severity: { type: "string", enum: ["info", "monitor", "attention", "urgent"] },
    confidence: { type: "number" },
    uncertainty: { type: "string" },
    missingEvidence: { type: "array", items: { type: "string" } },
    nextAction: { type: "string" },
  },
  required: ["observation", "severity", "confidence", "uncertainty", "missingEvidence", "nextAction"],
};

const system =
  "You assist a used-car inspector. Describe only what is visible in the photo. " +
  "Never diagnose a hidden fault or claim the car is free of defects. " +
  "State uncertainty and what additional evidence is needed.";

const res = await fetch(`${BASE_URL}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this photo of a car component and report your observation." },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "photo_finding", schema, strict: true },
    },
  }),
});

const body = await res.json();
if (!res.ok) {
  console.error(`HTTP ${res.status}`, JSON.stringify(body, null, 2));
  process.exit(1);
}

const text = body.choices?.[0]?.message?.content ?? "";
let finding;
try {
  finding = JSON.parse(text);
} catch {
  console.error("Model output was not valid JSON:\n", text);
  process.exit(1);
}
console.log(JSON.stringify(finding, null, 2));

const u = body.usage;
if (u) {
  const cost = (u.prompt_tokens * PRICE_PER_M.input + u.completion_tokens * PRICE_PER_M.output) / 1e6;
  console.log(`\ntokens in/out: ${u.prompt_tokens}/${u.completion_tokens}  est. cost: $${cost.toFixed(5)}`);
}
