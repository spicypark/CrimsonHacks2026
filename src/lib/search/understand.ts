import { z } from "zod";
import { claudeJson } from "@/lib/ai/claude";
import type { Filters } from "@/lib/events/filters";
import { WHEN } from "@/lib/events/filters";
import { geocode } from "@/lib/geo/geocode";
import { CATEGORIES, VIBE_TAGS } from "@/shared/event";

/**
 * Compact reply from Haiku: one-letter keys, and keys are left out when the search doesn't ask for them,
 * so a typical answer is ~15–25 output tokens. Unknown values are dropped rather than failing the parse.
 */
const known = <T extends string>(all: readonly T[]) =>
  z
    .union([z.array(z.string()), z.string().transform((s) => [s])]) // the model sometimes sends one value bare
    .catch([])
    .transform((xs) => [...new Set(xs.filter((x): x is T => (all as readonly string[]).includes(x)))]);

/** true / "true" only. z.coerce.boolean() would turn "false", 0-as-string and "no" into true. */
const flag = z
  .union([z.boolean(), z.string().transform((s) => s.trim().toLowerCase() === "true"), z.number().transform((n) => n === 1)])
  .optional()
  .catch(undefined);

const Reply = z.object({
  c: known(CATEGORIES).optional(),
  v: known(VIBE_TAGS.filter((v) => v !== "free")).optional(),
  f: flag,
  w: z.enum(WHEN).optional().catch(undefined),
  p: z.string().max(80).optional().catch(undefined),
  n: flag, // no longer asked for (see NEAR_ME), still tolerated
  k: z.string().max(120).optional().catch(undefined),
});
type Reply = z.infer<typeof Reply>;

// Kept short on purpose: every token here is paid on every new search. Times are relative ("tonight"),
// so the current date isn't needed — the server resolves them.
const SYSTEM = `Turn an event search (Salt Lake City area) into JSON. Omit any key the search doesn't clearly ask for.
{"k":"topic words","c":[category],"v":[vibe],"f":true if free,"w":time,"p":"place"}
k: any specific activity or topic, e.g. "jazz", "hiking", "yoga", "trivia", "comedy", "board games". Never generic words like fun, stuff, events, things, ideas.
c: only for a broad kind with no specific topic ("live music"→music, "sports", "food"→food-drink). One of: ${CATEGORIES.join(" ")}
v: only for words about feel or audience ("chill", "kids", "21+", "solo"). One of: ${VIBE_TAGS.filter((v) => v !== "free").join(" ")}
w: ${WHEN.join(" ")}
p: a named neighborhood, city, venue or landmark
Examples: "events near me"→{} "date night ideas"→{} "free jazz in provo saturday"→{"k":"jazz","f":true,"w":"weekend","p":"Provo"}
JSON only.`;

/** Small in-memory cache: the same search typed twice costs nothing. */
const cache = new Map<string, Reply>();
const CACHE_MAX = 200;

async function ask(text: string): Promise<Reply> {
  const key = text.toLowerCase().replace(/\s+/g, " ").trim();
  const hit = cache.get(key);
  if (hit) return hit;
  const result = await claudeJson({ task: "search", system: SYSTEM, prompt: key, schema: Reply, maxTokens: 80 });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

export interface SearchPlan {
  /** Filters to put in the URL. Replaces any previous search-derived filters. */
  filters: Partial<Filters>;
  /** The user asked for "near me": the client should ask for location and sort by distance. */
  nearMe: boolean;
}

/**
 * Natural-language search → URL filters. "free chill music near Sugar House tonight" becomes
 * { cat: [music], vibe: [chill], free: 1, when: tonight, near: "Sugar House", lat, lng }.
 * Throws if Claude doesn't answer; callers fall back to plain keyword search.
 */
export async function understand(text: string): Promise<SearchPlan> {
  const u = await ask(text);
  const keywords = u.k?.trim().toLowerCase() ?? "";
  const filters: Partial<Filters> = {
    ask: text,
    q: keywords || undefined,
    // Topic words already match by meaning, and a guessed category can contradict how the event was filed
    // ("comedy" → Arts & Culture, while the comedy show is Nightlife). Categories only narrow broad searches.
    cat: keywords ? [] : (u.c ?? []),
    vibe: u.v ?? [],
    free: u.f ? "1" : undefined,
  };
  // Same for time: a window nobody asked for ("date night ideas" → weekend) silently hides most events.
  if (u.w && TIME_WORDS.test(text)) filters.when = u.w;

  if (u.p) {
    const point = await geocode(u.p);
    if (point) Object.assign(filters, { near: u.p, lat: point.lat, lng: point.lng });
    // Unknown place: keep it as a search word rather than dropping it.
    else filters.q = [filters.q, u.p.toLowerCase()].filter(Boolean).join(" ");
  }
  // The model sometimes sets n for searches that never mention distance ("basketball game"), which would
  // pop a location prompt and re-sort the list. Only trust it when the words are actually there.
  const saysNear = NEAR_ME.test(text);
  return { filters, nearMe: saysNear && !filters.near };
}

const NEAR_ME = /\b(?:near|close to|around|by)\s+(?:me|here|us|my (?:place|house|location))\b|\bnearby\b|\bclose by\b|\bwalking distance\b|\bin my area\b|\bwhere i am\b/i;

const TIME_WORDS =
  /\b(?:now|today|tonight|this (?:evening|afternoon|morning)|tomorrow|weekend|week|month|(?:mon|tues|wednes|thurs|fri|satur|sun)day|sat|sun|fri|later|soon|upcoming|this \w+)\b/i;
