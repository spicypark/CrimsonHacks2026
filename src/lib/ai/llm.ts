import { z } from "zod";
import { claudeJson } from "./claude";

/** Pipeline calls (extraction, enrichment, dedupe) get room to finish; a person waiting gets a short timeout. */
const PIPELINE_TIMEOUT_MS = 90_000;
const INTERACTIVE_TIMEOUT_MS = 8_000;
/** Big enough for 25 extracted events or a full enrichment batch. */
const PIPELINE_MAX_TOKENS = 16_000;
const INTERACTIVE_MAX_TOKENS = 4_000;

/**
 * The AI seam for the pipeline and other non-search tasks. Callers ask for a typed JSON object;
 * Claude Haiku answers (see ./claude.ts). The JSON Schema goes in the system prompt and zod validates
 * the reply; one malformed reply is retried once. Rate limits and overloads are retried by the SDK.
 *
 * Contract: resolves with a value that passed `schema`, or throws.
 */
export interface JsonRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Short name for logs, e.g. "extract". */
  task: string;
  /** A person is waiting on this: short timeout and fewer retries; callers have a fallback. */
  interactive?: boolean;
  /** Per-call timeout override (ms). */
  timeoutMs?: number;
}

export async function generateJson<T>(req: JsonRequest<T>): Promise<T> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(req.schema, { target: "draft-7" }));
  const call = () =>
    claudeJson({
      task: req.task,
      system: `${req.system}\n\nReply with ONLY a JSON object (no prose, no code fence) matching this JSON Schema:\n${jsonSchema}`,
      prompt: req.prompt,
      schema: req.schema,
      maxTokens: req.interactive ? INTERACTIVE_MAX_TOKENS : PIPELINE_MAX_TOKENS,
      timeoutMs: req.timeoutMs ?? (req.interactive ? INTERACTIVE_TIMEOUT_MS : PIPELINE_TIMEOUT_MS),
      maxRetries: req.interactive ? 1 : 4,
    });
  try {
    return await call();
  } catch (e) {
    // A reply that wasn't valid JSON for the schema is worth one more try; API errors were already retried.
    if (!(e instanceof SyntaxError || e instanceof z.ZodError) || req.interactive) throw e;
    return call();
  }
}
