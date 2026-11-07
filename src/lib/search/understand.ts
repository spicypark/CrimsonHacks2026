import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";
import { generateJson } from "@/lib/ai/llm";
import type { Filters } from "@/lib/events/filters";
import { WHEN } from "@/lib/events/filters";
import { VIBE_LABELS } from "@/lib/events/format";
import { geocode } from "@/lib/geo/geocode";
import { CATEGORIES, CATEGORY_LABELS, Category, VIBE_TAGS, VibeTag } from "@/shared/event";
import { TIME_ZONE } from "@/shared/time";

/** What Gemini returns for a search. Every field is optional in spirit: empty means "not mentioned". */
const Understood = z.object({
  categories: z.array(Category).max(4),
  vibeTags: z.array(VibeTag).max(4),
  freeOnly: z.boolean(),
  when: z.enum(WHEN).nullable(),
  place: z.string().max(80).nullable(),
  nearMe: z.boolean(),
  keywords: z.string().max(120),
});
type Understood = z.infer<typeof Understood>;

const WHEN_HELP: Record<(typeof WHEN)[number], string> = {
  now: "happening right now",
  today: "rest of today",
  tonight: "this evening (after 5 PM today)",
  tomorrow: "tomorrow",
  weekend: "this coming Friday evening through Sunday",
  week: "next 7 days",
  month: "next 30 days",
};

const SYSTEM = `You turn a search for local events along Utah's Wasatch Front into structured filters.
Only set a field when the search clearly asks for it; otherwise leave it empty/null/false. Never guess.

categories — pick from: ${CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(", ")}.
  Only when the search names a kind of event ("live music" → music, "hike" → outdoors, "bouldering" → climbing).
vibeTags — pick from: ${VIBE_TAGS.filter((v) => v !== "free").map((v) => `${v} (${VIBE_LABELS[v]})`).join(", ")}.
  Only for words about the feel or audience ("chill", "with my kids" → family-friendly, "make friends" → meet-people).
freeOnly — true only for "free", "no cost", "$0" and similar.
when — one of: ${WHEN.map((w) => `${w} (${WHEN_HELP[w]})`).join(", ")}. null if no time is mentioned.
place — a neighborhood, city, venue or landmark the user wants to be near or in ("Sugar House", "Ogden", "the U").
  null if none. Not "me"/"here".
nearMe — true for "near me", "nearby", "close by", "walking distance".
keywords — the specific topic words the filters above don't capture (e.g. "jazz", "board games", "trivia", "salsa").
  Lowercase, space-separated, no words already covered by a category, vibe, time, price or place.
  Never generic words like "fun", "stuff", "things", "events", "something", "cool", "good", "activities".
  Empty string if nothing is left.`;

/** Small in-memory cache: the same search typed twice shouldn't cost a second AI call. */
const cache = new Map<string, Understood>();
const CACHE_MAX = 200;

async function ask(text: string, now: Date): Promise<Understood> {
  const key = text.toLowerCase().replace(/\s+/g, " ");
  const hit = cache.get(key);
  if (hit) return hit;
  const local = new TZDate(now, TIME_ZONE);
  const result = await generateJson({
    task: "search",
    system: SYSTEM,
    prompt: `It is ${format(local, "EEEE, MMMM d, yyyy, h:mm a")} in Utah.\nSearch: ${JSON.stringify(text)}`,
    schema: Understood,
  });
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
 * Throws if no AI provider answers; callers fall back to plain keyword search.
 */
export async function understand(text: string, now = new Date()): Promise<SearchPlan> {
  const u = await ask(text, now);
  const filters: Partial<Filters> = {
    ask: text,
    q: u.keywords.trim() || undefined,
    cat: [...new Set(u.categories)],
    vibe: [...new Set(u.vibeTags.filter((v) => v !== "free"))],
    free: u.freeOnly ? "1" : undefined,
  };
  if (u.when) filters.when = u.when;

  if (u.place) {
    const point = await geocode(u.place);
    if (point) Object.assign(filters, { near: u.place, lat: point.lat, lng: point.lng });
    // Unknown place: keep it as a search word rather than dropping it.
    else filters.q = [filters.q, u.place.toLowerCase()].filter(Boolean).join(" ");
  }
  return { filters, nearMe: u.nearMe && !filters.near };
}
