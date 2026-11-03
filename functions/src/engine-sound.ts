import {
  CLIP_PLACES,
  ENGINE_CONCERNS,
  ENGINE_SOUNDS,
  type EngineClipContext,
  type EngineSoundResult,
  engineSoundJsonSchema,
  validateEngineSound,
} from "../../lib/schemas/engine-sound";
import { describeDtc } from "../../lib/diagnostics/dtc-database";
import { redactFreeText } from "../../lib/diagnostics/symptoms";
import type { MetaClient, Usage } from "./shared/meta-client";

/** Muse Spark 1.2: Meta's docs recommend it over 1.3 for audio, which is most of this job. */
export const ENGINE_SOUND_MODEL = "muse-spark-1.2";
/** Frames per second sampled from the clip. The sound matters most; a few frames are enough to see smoke, leaks or a wobbling belt. */
const VIDEO_FPS = 2;

export const ENGINE_SOUND_SYSTEM_PROMPT = `You are an experienced car mechanic in India listening to a short phone video of a running engine, recorded by the owner. Diagnose by ear first, then by eye.
How to listen:
- The sound track matters most. Judge the idle rhythm: a healthy engine idles with an even, steady beat. A regular skip, stumble or "chuff" in the beat suggests a misfire.
- Relate sounds to engine speed. Use the OBD rpm trace when given: a sound whose rate rises with rpm comes from the engine's rotating parts; one that changes with load (knock, ping) or only on the rev (belt squeal) points elsewhere.
  - Light, fast ticking at half engine speed: valve train (tappets, low oil) or injectors (often normal on direct-injection and diesel engines).
  - Deep knocking that rises with rpm: bottom end (rod or main bearings). Serious.
  - Metallic pinging under load: pre-ignition, fuel quality or ignition timing.
  - High-pitched squeal on start or rev: drive belt slipping. Whine that follows rpm: alternator, power steering pump, idler or water pump bearing.
  - Rattle at idle that settles on the rev: heat shield or timing chain at cold start.
  - Hiss: vacuum or intake leak. Rhythmic puffing near the manifold: exhaust leak.
- Diesel engines are naturally louder and clattery; do not report normal diesel clatter as a fault.
- Then look: smoke colour (blue = oil, white and thick = coolant, black = rich fuel), leaks, a wobbling belt or pulley, loose parts.
Rules:
- Phone microphones exaggerate some sounds and wind or handling noise is common. If the engine can't be heard clearly (wind, talking, music, mic covered, too far away, engine off), set clipQuality to "poor", explain in qualityNote, and do not diagnose from it.
- Report only what you actually hear or see in this clip. The owner's concerns are what they noticed, not facts: confirm one only if you hear it. Never invent readings.
- fromS/toS are seconds into the clip where the sound is clearest; null if it is present throughout.
- likelySources are possibilities, most likely first. Say "could" or "may". Never claim a part has failed or that the car is safe.
- severity: "info" for normal sounds worth knowing about, "monitor" for minor, "attention" to get checked soon, "urgent" for possible serious damage (bearing knock, heavy misfire, overheating).
- driveAdvice: "stop" if driving could cause damage or danger; "caution" to drive gently to a mechanic soon; "ok" when nothing worrying is heard. When unsure, choose the more cautious option.
- obdNotes: how the live data supports or contradicts what you heard (for example rpm hunting at idle, fuel trims, a misfire code). Leave empty when no live data is given. If the live data is SIMULATED, say so and do not rely on it.
- nextSteps: practical things for the owner, such as what to tell the mechanic or a better recording to take.
- If the sound is normal, say so plainly and return no sounds. Plain language; explain any jargon briefly.`;

/** The clip's context as lines for the model, with personal details stripped from free text. */
export function engineClipContext(ctx: EngineClipContext): string {
  const lines: string[] = [];
  const v = ctx.vehicle;
  if (v) {
    const desc = [v.year, v.make, v.model, v.fuel, v.displacementL ? `${v.displacementL} L` : null].filter(Boolean).join(" ");
    if (desc) lines.push(`Vehicle: ${desc}${v.odometerKm ? `, about ${Math.round(v.odometerKm).toLocaleString("en-IN")} km` : ""}`);
  }
  lines.push(`Clip: ${ctx.durationS.toFixed(0)} s, recorded ${CLIP_PLACES[ctx.place].toLowerCase()}.`);
  lines.push(`Engine: ${ctx.engineWarm == null ? "temperature not known" : ctx.engineWarm ? "warmed up" : "cold start"}.`);
  lines.push("The owner was guided to hold steady at idle, give one gentle rev, then let it return to idle.");

  lines.push("", "What the owner noticed:");
  if (!ctx.concerns.length && !ctx.description?.trim()) lines.push("- nothing specific (a general check)");
  for (const c of ctx.concerns) lines.push(`- ${ENGINE_CONCERNS[c]}`);
  if (ctx.description?.trim()) lines.push(`- Owner says: "${redactFreeText(ctx.description)}"`);

  const o = ctx.obd;
  if (o) {
    lines.push("", `Live OBD data during the clip${o.simulated ? " (SIMULATED demo data, not from this engine)" : ""}:`);
    lines.push(`- Check-engine light ${o.milOn ? "ON" : "off"}`);
    const codes = [...o.stored.map((c) => `${c} (stored)`), ...o.pending.map((c) => `${c} (pending)`)];
    lines.push(`- Trouble codes: ${codes.length ? codes.map((c) => `${c} ${describeDtc(c.slice(0, 5)).title}`).join("; ") : "none"}`);
    for (const p of o.trace) {
      const parts = [
        p.rpm != null ? `${Math.round(p.rpm)} rpm` : null,
        p.engineLoad != null ? `load ${Math.round(p.engineLoad)}%` : null,
        p.throttle != null ? `throttle ${Math.round(p.throttle)}%` : null,
        p.coolantTemp != null ? `coolant ${Math.round(p.coolantTemp)}°C` : null,
        p.shortFuelTrim1 != null ? `STFT ${p.shortFuelTrim1.toFixed(1)}%` : null,
        p.longFuelTrim1 != null ? `LTFT ${p.longFuelTrim1.toFixed(1)}%` : null,
        p.map != null ? `MAP ${Math.round(p.map)} kPa` : null,
        p.maf != null ? `MAF ${p.maf.toFixed(1)} g/s` : null,
      ].filter(Boolean);
      if (parts.length) lines.push(`- t=${p.t.toFixed(0)}s: ${parts.join(", ")}`);
    }
  } else {
    lines.push("", "No OBD adapter was connected, so there is no live data.");
  }
  lines.push("", `Sound kinds you may report: ${Object.entries(ENGINE_SOUNDS).map(([k, label]) => `${k} (${label})`).join(", ")}.`);
  return lines.join("\n");
}

export type EngineSoundOutcome =
  | { status: "ok"; result: EngineSoundResult; dropped: number; usage: Usage[] }
  | { status: "ai_unavailable"; usage: Usage[] };

/** Listen to one clip. Schema-validated; retried once; never raw text. */
export async function analyzeEngineSound(video: Buffer, ctx: EngineClipContext, client: MetaClient): Promise<EngineSoundOutcome> {
  const usage: Usage[] = [];
  const url = `data:video/mp4;base64,${video.toString("base64")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, usage: u } = await client.completeJson({
      model: ENGINE_SOUND_MODEL,
      system: ENGINE_SOUND_SYSTEM_PROMPT,
      user: [
        { type: "text", text: `${engineClipContext(ctx)}\n\nListen to and watch this clip, then give your assessment.` },
        { type: "video_url", video_url: { url, fps: VIDEO_FPS } },
      ],
      schemaName: "engine_sound",
      schema: engineSoundJsonSchema,
      schemaInPromptFallback: true,
    });
    usage.push(u);
    const v = validateEngineSound(json, ctx);
    if (v) return { status: "ok", result: v.result, dropped: v.dropped, usage };
  }
  return { status: "ai_unavailable", usage };
}
