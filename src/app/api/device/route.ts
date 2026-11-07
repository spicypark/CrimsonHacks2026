import { connection } from "next/server";
import { type Filters, WHEN, parseFilters } from "@/lib/events/filters";
import { dayKey, dayLabel, formatTimeRange, isLive } from "@/lib/events/format";
import { type EventView, queryEvents } from "@/lib/events/query";
import { understand } from "@/lib/search/understand";
import { topicFilter } from "@/lib/search/topic";
import { CATEGORY_LABELS } from "@/shared/event";

/**
 * GET /api/device?for=<interests>&when=<week|today|...>&n=<1-8>
 *
 * Feed for the desk display (device/pullup_display): the few events the display thinks are coolest for
 * the given interests, already formatted as short plain-ASCII strings so the microcontroller only draws.
 * Interests are free text ("live music, climbing, free food") and go through the same AI search as the site.
 * If nothing matches, it falls back to the most popular upcoming events (`matched: false`).
 */

const MAX_EVENTS = 8;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const interests = (url.searchParams.get("for") ?? "").trim().slice(0, 200);
  const whenParam = url.searchParams.get("when");
  const when: Filters["when"] = (WHEN as readonly string[]).includes(whenParam ?? "") ? (whenParam as Filters["when"]) : "week";
  const n = Math.min(MAX_EVENTS, Math.max(1, Number(url.searchParams.get("n")) || 5));

  const key = `${interests.toLowerCase()}|${when}|${n}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json(hit.body);

  const base = parseFilters({ when });
  let matched: EventView[] = [];
  if (interests) {
    let filters: Filters = { ...base, q: interests };
    try {
      const plan = await understand(interests);
      // The display's time window wins over any time the AI read into the interests.
      filters = { ...base, ...plan.filters, when, sort: "soon" };
    } catch (e) {
      console.error("[device] understand failed, using keywords:", (e as Error).message.slice(0, 200));
    }
    const candidates = queryEvents({ ...filters, q: undefined });
    matched = filters.q ? await topicFilter(filters.q, candidates) : candidates;
  }

  const isMatch = matched.length > 0;
  const pool = isMatch ? matched : queryEvents(base);
  const now = Date.now();
  const picks = [...pool].sort((a, b) => coolness(b, now) - coolness(a, now)).slice(0, n);

  const body = {
    now: Math.floor(now / 1000),
    interests,
    matched: isMatch,
    count: pool.length,
    events: picks.map((e) => toDevice(e, now)),
  };
  if (cache.size > 50) cache.clear();
  cache.set(key, { at: now, body });
  return Response.json(body);
}

/**
 * How "cool" an event is for a glanceable display: popularity, corroboration across sources,
 * and how soon it is (something tonight beats something equally hyped next week).
 */
function coolness(e: EventView, now: number): number {
  const buzz = (e.buzzScore ?? 20) / 100; // 0–1; unknown counts as mildly popular
  const sources = Math.min(e.sources.length, 4) - 1; // 0–3 extra sources
  const hoursAway = Math.max(0, (new Date(e.startsAt).getTime() - now) / 3_600_000);
  const soon = isLive(e.startsAt, e.endsAt, now) ? 1 : Math.max(0, 1 - hoursAway / 72);
  return buzz * 0.5 + sources * 0.1 + soon * 0.4 + e.confidence * 0.1;
}

function toDevice(e: EventView, now: number) {
  const start = new Date(e.startsAt).getTime();
  const end = new Date(e.endsAt).getTime();
  return {
    id: e.id,
    title: ascii(e.title),
    day: ascii(dayLabel(dayKey(e.startsAt), new Date(now))),
    time: ascii(formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated).replace(", ends around ", " - ~")),
    venue: ascii(e.venueName ?? ""),
    address: ascii(shortAddress(e.address)),
    category: e.category ? ascii(CATEGORY_LABELS[e.category]) : "",
    price: e.isFree ? "FREE" : ascii(e.priceText ?? (e.isFree === false ? "Paid" : "")),
    buzz: e.buzzScore ?? -1,
    sources: e.sources.length,
    start: Math.floor(start / 1000),
    end: Math.floor(end / 1000),
    live: isLive(e.startsAt, e.endsAt, now),
  };
}

/** "123 Main St, Salt Lake City, UT 84101, USA" → "123 Main St, Salt Lake City". */
function shortAddress(address: string | null): string {
  if (!address) return "";
  return address
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^(USA|United States|UT|Utah)$/i.test(s) && !/^(UT|Utah)\s+\d{5}/i.test(s))
    .slice(0, 2)
    .join(", ");
}

/** The display's built-in fonts only cover printable ASCII. */
function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[–—−]/g, "-")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[·•]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
