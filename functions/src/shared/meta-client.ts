const BASE_URL = "https://api.meta.ai/v1";

/** USD per million tokens, from https://dev.meta.ai/docs/pricing-rate-limits. Standard model IDs only. */
const PRICES: Record<string, { input: number; output: number }> = {
  "muse-spark-1.3": { input: 1.25, output: 4.25 },
  "muse-spark-1.2": { input: 1.25, output: 4.25 },
  "muse-wonder-1.0": { input: 4.0, output: 20.0 },
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  /** MP4 as a URL or base64 data URI; its sound track is heard too. `fps` sets frame sampling. */
  | { type: "video_url"; video_url: { url: string; fps?: number } };

export interface JsonRequest {
  model?: string;
  system: string;
  user: string | ContentPart[];
  schemaName: string;
  schema: object;
  /** Extra body fields, e.g. a reasoning level once the parameter name is confirmed. */
  extra?: Record<string, unknown>;
  /**
   * If the API rejects structured output for this input (HTTP 400), ask again with the schema in the
   * prompt and parse JSON from the text. For media types where json_schema support isn't documented.
   */
  schemaInPromptFallback?: boolean;
}

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** JSON from a reply, tolerating code fences or a sentence around the object. Null if none. */
export function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MetaClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Base delay for exponential backoff on 429 / 5xx. */
  baseDelayMs?: number;
}

export class MetaClient {
  constructor(private o: MetaClientOptions) {}

  /** One schema-constrained completion. Returns the parsed JSON (unvalidated) and its usage. */
  async completeJson(req: JsonRequest): Promise<{ json: unknown; usage: Usage }> {
    const model = req.model ?? "muse-spark-1.3";
    if (model.endsWith("-contributor")) {
      // Contributor models train on inputs. Never allow them for user data.
      throw new Error("Contributor models are not allowed");
    }
    const { $schema: _omit, ...schema } = req.schema as Record<string, unknown>;
    const body = {
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName, schema, strict: false },
      },
      ...req.extra,
    };

    let res;
    try {
      res = await this.post("/chat/completions", body);
    } catch (e) {
      if (!(req.schemaInPromptFallback && e instanceof MetaApiError && e.status === 400)) throw e;
      const { response_format: _rf, ...plain } = body;
      plain.messages = [
        {
          role: "system",
          content: `${req.system}\n\nReply with one JSON object only, no other text, matching this JSON schema:\n${JSON.stringify(schema)}`,
        },
        { role: "user", content: req.user },
      ];
      res = await this.post("/chat/completions", plain);
    }
    const text: string = res.choices?.[0]?.message?.content ?? "";
    const json = parseJsonReply(text);
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    const price = PRICES[model] ?? { input: 0, output: 0 };
    return {
      json,
      usage: {
        model,
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * price.input + outputTokens * price.output) / 1e6,
      },
    };
  }

  private async post(path: string, body: unknown): Promise<any> {
    const f = this.o.fetchImpl ?? fetch;
    const max = this.o.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const res = await f(BASE_URL + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.o.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          // A 200 with a non-JSON body (e.g. a gateway error page) must not look like a model reply.
          throw new MetaApiError(
            res.status,
            `Meta API returned non-JSON (${res.headers.get("content-type")}): ${text.slice(0, 200)}`,
          );
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max) {
        throw new MetaApiError(res.status, `Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = retryAfter > 0 ? retryAfter * 1000 : (this.o.baseDelayMs ?? 500) * 2 ** attempt * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
