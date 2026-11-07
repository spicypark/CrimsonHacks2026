import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "@/lib/env";

/** Per-call ceiling so one slow AI call can't stall a pipeline run; the next provider is tried on timeout. */
const CALL_TIMEOUT_MS = 45_000;
/** Interactive calls give up sooner; search has a non-AI fallback. */
const INTERACTIVE_TIMEOUT_MS = 8_000;

/**
 * The AI seam. Callers ask for a typed JSON object; which provider answers is hidden.
 * Two real adapters (Gemini primary, Groq fallback) — the fallback kicks in on any provider error
 * (rate limit, outage, invalid JSON).
 *
 * Contract: resolves with a value that passed `schema`, or throws if every provider failed.
 */
export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Short name for logs, e.g. "extract". */
  task: string;
  /**
   * A person is waiting on this (search). Uses the fast model chain with minimal thinking, skips the
   * pipeline pacing gate, and fails fast instead of retrying for minutes; callers have a fallback.
   */
  interactive?: boolean;
}

interface Provider {
  name: string;
  available(): boolean;
  json(req: JsonRequest<unknown>, jsonSchema: unknown): Promise<string>;
}

let gemini: GoogleGenAI | null = null;
const geminiClient = () => (gemini ??= new GoogleGenAI({ apiKey: env.geminiKey! }));

/** One provider per configured Gemini model, so a 503 "high demand" on one model falls through to the next. */
const geminiProvider = (model: string): Provider => ({
  name: `gemini:${model}`,
  available: () => !!env.geminiKey,
  async json(req, jsonSchema) {
    const call = (constrained: boolean) =>
      geminiClient().models.generateContent({
        model,
        contents: req.prompt,
        config: {
          systemInstruction: constrained
            ? req.system
            : `${req.system}\n\nRespond ONLY with JSON matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
          responseMimeType: "application/json",
          ...(constrained ? { responseJsonSchema: geminiSafeSchema(jsonSchema) } : {}),
          temperature: 0.2,
          // Extraction is pattern-matching, not reasoning: low thinking keeps calls fast and cheap.
          thinkingConfig: { thinkingLevel: req.interactive ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW },
          abortSignal: AbortSignal.timeout(req.interactive ? INTERACTIVE_TIMEOUT_MS : CALL_TIMEOUT_MS),
        },
      });
    try {
      return (await call(true)).text ?? "";
    } catch (e) {
      // Gemini supports a subset of JSON Schema; if it rejects ours, ask for JSON via the prompt and let zod validate.
      if (!/INVALID_ARGUMENT|"code":400/.test((e as Error).message)) throw e;
      return (await call(false)).text ?? "";
    }
  },
});

/** Drops JSON Schema keywords Gemini rejects: `$schema`, `additionalProperties`, and zod's ±2^53 integer bounds. */
function geminiSafeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSafeSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    if ((k === "minimum" || k === "maximum") && typeof v === "number" && Math.abs(v) >= Number.MAX_SAFE_INTEGER) continue;
    out[k] = geminiSafeSchema(v);
  }
  return out;
}

let groq: Groq | null = null;
const groqProvider: Provider = {
  name: "groq",
  available: () => !!env.groqKey,
  async json(req, jsonSchema) {
    groq ??= new Groq({ apiKey: env.groqKey!, timeout: CALL_TIMEOUT_MS, maxRetries: 1 });
    const res = await groq.chat.completions.create({
      model: env.groqModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${req.system}\n\nRespond ONLY with JSON matching this JSON Schema:\n${JSON.stringify(jsonSchema)}` },
        { role: "user", content: req.prompt },
      ],
    });
    return res.choices[0]?.message?.content ?? "";
  },
};

const providers = (interactive = false): Provider[] =>
  [...(interactive ? env.geminiFastModels : env.geminiModels).map(geminiProvider), groqProvider].filter(
    (p) => !interactive || !coolingDown(p.name),
  );

/**
 * Interactive calls skip a model for a minute after it reports quota exhausted (429), instead of paying
 * a round trip to be refused again on every search.
 */
const QUOTA_COOLDOWN_MS = 60_000;
const exhaustedUntil = new Map<string, number>();
const coolingDown = (name: string) => (exhaustedUntil.get(name) ?? 0) > Date.now();
const noteFailure = (name: string, msg: string) => {
  if (/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) exhaustedUntil.set(name, Date.now() + QUOTA_COOLDOWN_MS);
};

/**
 * Free-tier quotas are per minute, so AI requests are started at most once every `AI_MIN_INTERVAL_MS`
 * (default 2.5 s) across the whole process. Calls may still overlap; only their start times are spaced.
 */
const MIN_INTERVAL_MS = Number(process.env.AI_MIN_INTERVAL_MS ?? 2500);
let gate: Promise<void> = Promise.resolve();
let lastStart = 0;
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const turn = gate.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  gate = turn;
  return turn.then(fn);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTransient = (msg: string) => /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|aborted|timed? ?out/i.test(msg);

/** If every provider failed for a transient reason (quota/overload/timeout), wait this long and try the chain again. */
const RETRY_DELAYS_MS = [20_000, 45_000];

export async function generateJson<T>(req: JsonRequest<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" });
  const errors: string[] = [];
  for (let attempt = 0; ; attempt++) {
    const round: string[] = [];
    for (const p of providers(req.interactive).filter((x) => x.available())) {
      try {
        const run = () => p.json(req as JsonRequest<unknown>, jsonSchema);
        const raw = await (req.interactive ? run() : paced(run));
        return req.schema.parse(JSON.parse(raw));
      } catch (e) {
        const msg = (e as Error).message;
        if (req.interactive) noteFailure(p.name, msg);
        round.push(`${p.name}: ${msg.slice(0, 200)}`);
      }
    }
    errors.push(...round);
    const allTransient = round.length > 0 && round.every(isTransient);
    if (!allTransient || req.interactive || attempt >= RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  throw new Error(`AI task "${req.task}" failed — ${errors.join(" | ") || "no AI provider configured (set GEMINI_API_KEY)"}`);
}

export const EMBED_DIMS = 768;
const EMBED_BATCH = 100; // API maximum per request

/** Embeds texts with Gemini in batches of 100. Returns unit-length Float32Arrays (so cosine = dot product). */
export async function embed(texts: string[], opts: { interactive?: boolean } = {}): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    for (let attempt = 0; ; attempt++) {
      try {
        const run = () =>
          geminiClient().models.embedContent({
            model: env.geminiEmbedModel,
            contents: batch,
            config: {
              outputDimensionality: EMBED_DIMS,
              abortSignal: AbortSignal.timeout(opts.interactive ? INTERACTIVE_TIMEOUT_MS : CALL_TIMEOUT_MS),
            },
          });
        const res = await (opts.interactive ? run() : paced(run));
        out.push(...(res.embeddings ?? []).map((e) => normalize(Float32Array.from(e.values ?? []))));
        break;
      } catch (e) {
        if (opts.interactive || !isTransient((e as Error).message) || attempt >= RETRY_DELAYS_MS.length) throw e;
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  return out;
}

let embeddingsExhausted = false;

/**
 * Like `embed`, but never throws: if the daily embedding quota is used up (or the call fails), returns nulls
 * and stops calling for the rest of this process. Callers must handle missing vectors.
 */
export async function embedOrNull(texts: string[], opts: { interactive?: boolean } = {}): Promise<(Float32Array | null)[]> {
  if (!embeddingsExhausted) {
    try {
      return await embed(texts, opts);
    } catch (e) {
      if (/429|RESOURCE_EXHAUSTED|quota/i.test((e as Error).message)) embeddingsExhausted = true;
    }
  }
  return texts.map(() => null);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

export const toBlob = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
export const fromBlob = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
