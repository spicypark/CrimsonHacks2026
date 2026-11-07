import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";

/**
 * Claude for interactive search. Haiku 5.5 is the cheapest current model ($0.10 / $0.50 per million tokens),
 * and search requests are kept tiny: thinking off, short system prompts, compact JSON replies, small max_tokens.
 * Structured output is deliberately not used: it adds ~450 input tokens per call, more than the prompts themselves.
 */
export const SEARCH_MODEL = "claude-haiku-5-5";

let client: Anthropic | null = null;
export const claudeAvailable = () => !!process.env.ANTHROPIC_API_KEY?.trim();

/** Running token totals for this server process, so cost per search can be checked in the logs. */
export const claudeUsage = { calls: 0, input: 0, output: 0 };

export async function claudeJson<T>(req: {
  task: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Per-call timeout override (ms); default 8 s. */
  timeoutMs?: number;
}): Promise<T> {
  client ??= new Anthropic({ timeout: 8_000, maxRetries: 1 });
  const res = await client.messages.create(
    {
      model: SEARCH_MODEL,
      max_tokens: req.maxTokens,
      // Search is lookup, not reasoning: thinking off keeps the output to the JSON alone.
      thinking: { type: "disabled" },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    },
    req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
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
  if (start < 0 || end < start) throw new Error(`${req.task}: no JSON in reply`);
  return req.schema.parse(JSON.parse(text.slice(start, end + 1)));
}
