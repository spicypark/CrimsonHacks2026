import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Every AI call in the app goes to Claude Haiku 5.5, the cheapest current model ($0.10 / $0.50 per million tokens).
 * Requests are kept small: thinking off (extraction and lookup are pattern-matching, not reasoning), short system
 * prompts, compact JSON replies. Structured output is deliberately not used: it adds ~450 input tokens per call,
 * more than most of these prompts; zod validates replies instead.
 */
export const MODEL = "claude-haiku-5-5";

let client: Anthropic | null = null;
export const claudeAvailable = () => !!process.env.ANTHROPIC_API_KEY?.trim();

/** Running token totals for this process, so cost can be checked in the logs. */
export const claudeUsage = { calls: 0, input: 0, output: 0 };

export async function claudeJson<T>(req: {
  task: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Per-call timeout (ms); default 8 s, for search. */
  timeoutMs?: number;
  /** Retries on rate limits, overloads and connection errors; default 1. */
  maxRetries?: number;
}): Promise<T> {
  if (!claudeAvailable()) throw new Error(`${req.task}: ANTHROPIC_API_KEY is not set`);
  client ??= new Anthropic();
  const res = await client.messages.create(
    {
      model: MODEL,
      max_tokens: req.maxTokens,
      thinking: { type: "disabled" },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    },
    { timeout: req.timeoutMs ?? 8_000, maxRetries: req.maxRetries ?? 1 },
  );

  claudeUsage.calls++;
  claudeUsage.input += res.usage.input_tokens;
  claudeUsage.output += res.usage.output_tokens;
  console.log(`[claude] ${req.task}: ${res.usage.input_tokens} in / ${res.usage.output_tokens} out`);

  if (res.stop_reason === "refusal") throw new Error(`${req.task}: refused`);
  if (res.stop_reason === "max_tokens") throw new Error(`${req.task}: reply cut off at ${req.maxTokens} tokens`);
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  // Take the outermost {...}, tolerating a code fence or a stray sentence around it.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError(`${req.task}: no JSON in reply`);
  return req.schema.parse(JSON.parse(text.slice(start, end + 1)));
}
