import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "@/lib/env";

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
}

interface Provider {
  name: string;
  available(): boolean;
  json(req: JsonRequest<unknown>, jsonSchema: unknown): Promise<string>;
}

let gemini: GoogleGenAI | null = null;
const geminiClient = () => (gemini ??= new GoogleGenAI({ apiKey: env.geminiKey! }));

const geminiProvider: Provider = {
  name: "gemini",
  available: () => !!env.geminiKey,
  async json(req, jsonSchema) {
    const res = await geminiClient().models.generateContent({
      model: env.geminiModel,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        temperature: 0.2,
      },
    });
    return res.text ?? "";
  },
};

let groq: Groq | null = null;
const groqProvider: Provider = {
  name: "groq",
  available: () => !!env.groqKey,
  async json(req, jsonSchema) {
    groq ??= new Groq({ apiKey: env.groqKey! });
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

const PROVIDERS = [geminiProvider, groqProvider];

export async function generateJson<T>(req: JsonRequest<T>): Promise<T> {
  const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" });
  const errors: string[] = [];
  for (const p of PROVIDERS.filter((x) => x.available())) {
    try {
      const raw = await p.json(req as JsonRequest<unknown>, jsonSchema);
      return req.schema.parse(JSON.parse(raw));
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  throw new Error(`AI task "${req.task}" failed — ${errors.join(" | ") || "no AI provider configured (set GEMINI_API_KEY)"}`);
}

export const EMBED_DIMS = 768;

/** Embeds texts with Gemini. Returns unit-length Float32Arrays (so cosine = dot product). */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const res = await geminiClient().models.embedContent({
    model: env.geminiEmbedModel,
    contents: texts,
    config: { outputDimensionality: EMBED_DIMS },
  });
  return (res.embeddings ?? []).map((e) => normalize(Float32Array.from(e.values ?? [])));
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
