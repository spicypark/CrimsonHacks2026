import { z } from "zod";
import { claudeAvailable, claudeJson } from "@/lib/ai/claude";
import { matchesKeywords, type EventView } from "@/lib/events/query";
import { CATEGORY_LABELS } from "@/shared/event";

/**
 * Topic words ("stand up comedy") → the events about that topic, kept in their original (time) order.
 *
 * Haiku does only the language part: it expands the topic into a few terms an event listing would use
 * (comedy, comedian, stand-up). Matching those terms against titles, descriptions, venues and categories
 * happens here, in plain code. That keeps each new topic to one tiny call (~100 tokens in, ~20 out) no
 * matter how many events there are, and it can't mix up which event is which.
 * Falls back to plain keyword matching when Claude isn't available.
 */
const SYSTEM =
  "List words and short phrases likely to appear in the title or description of an event about this search topic: " +
  "the topic itself, close synonyms and specific kinds of it. 2-8 lowercase terms. No broad words that would match " +
  'unrelated events (for "jazz": not "music", "show" or "night"). JSON only: {"t":["term",...]}';

const Terms = z.object({ t: z.array(z.string()).catch([]) });

const cache = new Map<string, string[]>();
const CACHE_MAX = 500;

async function expand(query: string): Promise<string[]> {
  const hit = cache.get(query);
  if (hit) return hit;
  const { t } = await claudeJson({ task: "terms", system: SYSTEM, prompt: query, schema: Terms, maxTokens: 60 });
  const terms = [...new Set([query, ...t].map((x) => x.toLowerCase().trim()).filter((x) => x.length > 1))].slice(0, 10);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(query, terms);
  return terms;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match that tolerates plurals and spacing/hyphen differences ("stand-up" ~ "stand up" ~ "standup"). */
function termPattern(terms: string[]): RegExp {
  const parts = terms.map((t) => escape(t).replace(/(?:\\-|\s)+/g, "[\\s-]?"));
  return new RegExp(`\\b(?:${parts.join("|")})(?:s|es)?\\b`, "i");
}

const haystack = (e: EventView) =>
  `${e.title} ${e.summary} ${e.description} ${e.venueName ?? ""} ${e.category ? CATEGORY_LABELS[e.category] : ""}`;

/**
 * Ids of the events matching a topic by meaning (Haiku-expanded terms), or null when Claude is unavailable
 * or the call fails, so the caller can fall back to its own keyword scoring.
 */
export async function topicMatches(q: string, events: EventView[]): Promise<Set<string> | null> {
  const query = q.toLowerCase().trim();
  if (!claudeAvailable() || !query) return null;
  try {
    const pattern = termPattern(await expand(query));
    return new Set(events.filter((e) => pattern.test(haystack(e))).map((e) => e.id));
  } catch (e) {
    console.error("[topic] term expansion failed:", (e as Error).message.slice(0, 200));
    return null;
  }
}

export async function topicFilter(q: string, events: EventView[]): Promise<EventView[]> {
  const query = q.toLowerCase().trim();
  if (!events.length) return [];
  let terms = query.split(/\s+/);
  if (claudeAvailable()) {
    try {
      terms = await expand(query);
    } catch (e) {
      console.error("[search] term expansion failed, using keywords:", (e as Error).message.slice(0, 200));
      return events.filter((e) => matchesKeywords(query, haystack(e)));
    }
  }
  const pattern = termPattern(terms);
  return events.filter((e) => pattern.test(haystack(e)));
}
