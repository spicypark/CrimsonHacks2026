import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import { z } from "zod";
import { claudeAvailable, claudeJson } from "@/lib/ai/claude";
import { generateJson } from "@/lib/ai/llm";
import { FiltersSchema } from "@/lib/events/filters";
import { formatTime, priceLabel, VIBE_LABELS } from "@/lib/events/format";
import { type EventView, matchesKeywords, queryEvents } from "@/lib/events/query";
import { distanceM, geocode } from "@/lib/geo/geocode";
import { score } from "@/lib/search/semantic";
import { CATEGORIES, CATEGORY_LABELS, Category, VIBE_TAGS, VibeTag } from "@/shared/event";
import { TIME_ZONE, utahLocalToIso } from "@/shared/time";

/**
 * "Plan my night": a free-text description ("dinner-ish thing then live music, free after 7, near downtown")
 * → an ordered itinerary of real events from the database.
 *
 *  1. Understand: AI turns the text into a time window + interests/filters (fallback: tonight, text as keywords).
 *  2. Shortlist: every event overlapping the window, ranked by meaning (embeddings) against the interests.
 *  3. Compose: AI picks 1–4 stops in order with arrive/leave times and a reason for each.
 *  4. Check: the server fixes times to fit the events and the window, drops overlaps and adds travel estimates.
 *     If the AI is unavailable, a greedy scheduler builds the plan from the ranking instead.
 */

const HHMM = z.string().regex(/^\d{1,2}:\d{2}$/);

const Intent = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: HHMM,
  end: HHMM,
  interests: z.array(z.string().max(60)).max(6),
  categories: z.array(Category).max(4),
  vibeTags: z.array(VibeTag).max(4),
  freeOnly: z.boolean(),
  place: z.string().max(80).nullable(),
  stops: z.number().int().min(1).max(5).nullable(),
});
type Intent = z.infer<typeof Intent>;

const Composed = z.object({
  title: z.string().max(80),
  summary: z.string().max(500),
  stops: z
    .array(z.object({ event: z.number().int().min(1), arrive: HHMM, leave: HHMM, why: z.string().max(300) }))
    .max(5),
  backups: z.array(z.number().int().min(1)).max(4),
});

export interface PlanStop {
  event: EventView;
  arriveAt: string;
  leaveAt: string;
  why: string;
  /** Estimated drive from the previous stop; null for the first stop or when either location is unknown. */
  travel: { km: number; minutes: number } | null;
  /** Less time between stops than the drive needs. */
  tight: boolean;
}

export interface NightPlan {
  request: string;
  window: { from: string; to: string };
  title: string;
  summary: string;
  stops: PlanStop[];
  backups: EventView[];
  /** What was understood, shown back so people can see why they got this plan. */
  understood: { interests: string[]; freeOnly: boolean; place: string | null };
  ai: boolean;
}

/** Shortlist size sent to the composer. */
const SHORTLIST = 28;
/** An event must overlap the window by at least this much to be worth going to. */
const MIN_OVERLAP_MS = 40 * 60_000;
/** Named-place plans keep events within this radius. */
const PLACE_RADIUS_KM = 25;
const MAX_STOPS = 4;

/** A same-day plan with less free time than this left (it's 11 PM and they said "tonight") moves to tomorrow. */
const MIN_WINDOW_MS = 90 * 60_000;

export async function planNight(request: string, now = new Date()): Promise<NightPlan> {
  let ai = true;
  let intent: Intent;
  try {
    intent = await understandNight(request, now);
  } catch (e) {
    console.error("[plan] understand failed:", (e as Error).message.slice(0, 1200));
    ai = false;
    intent = fallbackIntent(request, now);
  }

  const point = intent.place ? await geocode(intent.place).catch(() => null) : null;
  let window = toWindow(intent, now);
  let ranked = await shortlist(intent, window, point);

  // Late in the evening "tonight" leaves a sliver of time (or nothing still starting). Rather than a
  // one-stop plan for the last hour, or "nothing fits", plan the same hours tomorrow and say so.
  let note = "";
  const today = format(new TZDate(now, TIME_ZONE), "yyyy-MM-dd");
  if (intent.date === today && (+window.to - +window.from < MIN_WINDOW_MS || !ranked.length)) {
    const local = new TZDate(now, TIME_ZONE);
    // At 11 PM the AI reads "tonight" as "from now" (start 23:00); tomorrow that should be the evening default.
    const [h, m] = intent.start.split(":").map(Number);
    const startIsNow = Math.abs(h * 60 + m - (local.getHours() * 60 + local.getMinutes())) <= 45;
    const next = {
      ...intent,
      date: format(addDays(local, 1), "yyyy-MM-dd"),
      start: startIsNow ? "17:00" : intent.start,
    };
    const nextWindow = toWindow(next, now);
    const nextRanked = await shortlist(next, nextWindow, point);
    if (nextRanked.length) {
      [intent, window, ranked] = [next, nextWindow, nextRanked];
      note = `Tonight is nearly over, so this is a plan for tomorrow (${format(new TZDate(window.from, TIME_ZONE), "EEEE")}).`;
    }
  }

  const plan = await build(request, intent, window, ranked, point, ai, now);
  if (note) plan.summary = `${note} ${plan.summary}`;
  return plan;
}

async function build(
  request: string,
  intent: Intent,
  window: { from: Date; to: Date },
  ranked: Ranked[],
  point: { lat: number; lng: number } | null,
  ai: boolean,
  now: Date,
): Promise<NightPlan> {

  const base = {
    request,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    understood: { interests: intent.interests, freeOnly: intent.freeOnly, place: point ? intent.place : null },
  };

  if (!ranked.length) {
    return {
      ...base,
      title: "Nothing fits that window",
      summary: "No listed events overlap the time you gave. Try a wider window or a different night.",
      stops: [],
      backups: [],
      ai,
    };
  }

  const wanted = Math.min(intent.stops ?? 3, MAX_STOPS);
  if (ai) {
    try {
      const composed = await compose(request, intent, window, ranked.map((r) => r.event), now);
      const timed = schedule(composed.stops.map((s) => ({ ...s, event: ranked[s.event - 1]?.event })), window, intent.date);
      if (timed.length) {
        const aiIds = new Set(timed.map((s) => s.event.id));
        const pick = (nums: number[]) =>
          [...new Set(nums)].map((n) => ranked[n - 1]?.event).filter((e): e is EventView => !!e && !aiIds.has(e.id));
        // Stops the time check removed lead the swaps; the AI's title and summary would still mention them.
        const dropped = pick(composed.stops.map((s) => s.event));
        // Losing a stop shouldn't leave a hole in the night: fill the freed time from the AI's swaps, then the ranking.
        let full = stayForShows(timed, window);
        if (dropped.length) {
          const swaps = composed.backups.map((n) => ranked[n - 1]).filter((r): r is Ranked => !!r);
          const target = Math.min(Math.max(composed.stops.length, 1), wanted);
          full = fillGaps(full, [...swaps, ...ranked].filter((r) => !dropped.includes(r.event)), window, target);
        }
        const stops = withTravel(fitTravel(stayForShows(full, window)));
        const used = new Set(stops.map((s) => s.event.id));
        const added = stops.filter((s) => !aiIds.has(s.event.id)).map((s) => s.event.title);
        const backups = [...dropped, ...pick(composed.backups).filter((e) => !dropped.includes(e) && !used.has(e.id))];
        const title = !dropped.length ? composed.title : stops.length > 1 ? `${stops.length} stops for your night` : "A pick for your night";
        const summary = !dropped.length
          ? composed.summary
          : `${dropped.map((e) => e.title).join(" and ")} didn't fit without arriving late or overlapping, so ${dropped.length > 1 ? "they're" : "it's"} under swap options` +
            (added.length ? `; ${added.join(" and ")} ${added.length > 1 ? "fill" : "fills"} that time instead.` : ".");
        return { ...base, title, summary, stops, backups: fillBackups(backups, ranked, used), ai };
      }
      console.warn("[plan] composer returned no usable stops, using greedy schedule");
    } catch (e) {
      ai = false;
      console.error("[plan] compose failed, using greedy schedule:", (e as Error).message.slice(0, 1200));
    }
  }

  const stops = greedy(ranked, window, wanted);
  const used = new Set(stops.map((s) => s.event.id));
  return {
    ...base,
    title: stops.length > 1 ? `${stops.length} stops for your night` : "A pick for your night",
    summary: "Picked from the closest matches to what you described that fit your time window.",
    stops,
    backups: fillBackups([], ranked, used),
    ai,
  };
}

// ── AI ───────────────────────────────────────────────────────────────────────

/**
 * Planner AI calls go to Claude Haiku when ANTHROPIC_API_KEY is set, and to the Gemini chain otherwise
 * (or when Claude fails). Claude gets structured outputs, so its JSON always parses: the composer's free-text
 * "why" sentences used to break hand-written JSON (an unquoted "Five Bags of Popcorn"). zod still validates the
 * reply, so length and range limits the API's schema subset can't express are checked there. If the API rejects
 * the schema, the prompt-only form is tried before Gemini.
 */
async function askAi<T>(req: { task: string; system: string; prompt: string; schema: z.ZodType<T>; maxTokens: number; timeoutMs: number }): Promise<T> {
  if (claudeAvailable()) {
    const jsonSchema = z.toJSONSchema(req.schema, { target: "draft-7" }) as Record<string, unknown>;
    try {
      return await claudeJson({ ...req, jsonSchema: outputSchema(jsonSchema) as Record<string, unknown> });
    } catch (e) {
      console.error(`[plan] Claude ${req.task} (structured) failed:`, (e as Error).message.slice(0, 300));
    }
    try {
      return await claudeJson({
        ...req,
        system: `${req.system}\n\nReply with ONLY a JSON object (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
      });
    } catch (e) {
      console.error(`[plan] Claude ${req.task} failed, trying Gemini:`, (e as Error).message.slice(0, 300));
    }
  }
  return generateJson({ task: req.task, system: req.system, prompt: req.prompt, schema: req.schema, interactive: true, timeoutMs: req.timeoutMs });
}

/**
 * zod's JSON Schema → the core subset structured outputs accept: types, enums, required, nullable unions.
 * Length, size, range and pattern keywords are dropped (zod enforces them after parsing), and every object is
 * closed with additionalProperties: false.
 */
function outputSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(outputSchema);
  if (!node || typeof node !== "object") return node;
  const DROP = new Set(["$schema", "maxLength", "minLength", "maxItems", "minItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (!DROP.has(k)) out[k] = outputSchema(v);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

// ── 1. Understand ────────────────────────────────────────────────────────────

const intentCache = new Map<string, Intent>();

async function understandNight(text: string, now: Date): Promise<Intent> {
  const local = new TZDate(now, TIME_ZONE);
  const key = `${format(local, "yyyy-MM-dd HH")}\n${text.toLowerCase().replace(/\s+/g, " ")}`;
  const hit = intentCache.get(key);
  if (hit) return hit;

  const days = Array.from({ length: 8 }, (_, i) => format(addDays(local, i), "EEEE yyyy-MM-dd")).join(", ");
  const result = await askAi({
    task: "plan-understand",
    maxTokens: 400,
    timeoutMs: 10_000,
    system: `You read how someone describes the night (or day) they want along Utah's Wasatch Front and return
the time window and what they are into. Today and the next week: ${days}.

date — the day they mean (YYYY-MM-DD). "tonight"/no day → today. "Saturday" → the next Saturday (today if it is Saturday).
start, end — 24h "HH:MM" Utah time of when they are free. Defaults: an evening/"tonight"/no times → 17:00 to 23:59.
  "after 7" → start 19:00. "until 11" → end 23:00. "late"/"all night" → end 02:00. A daytime plan ("Saturday afternoon")
  → 12:00 to 18:00; "morning" → 08:00 to 12:00; "all day" → 09:00 to 23:59. end may be after midnight (e.g. 01:00).
interests — short phrases for each kind of thing they want to do, in their words ("live jazz", "board games",
  "something outdoors", "dinner"). Empty if they did not say.
categories — from: ${CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(", ")}. Only kinds they clearly named.
vibeTags — from: ${VIBE_TAGS.filter((v) => v !== "free").map((v) => `${v} (${VIBE_LABELS[v]})`).join(", ")}.
  Only for words about the feel or audience ("with my kids" → family-friendly, "on a date" → nothing, "solo" → go-solo).
freeOnly — true when they want things that cost nothing: "free live music" → true, "free events" → true,
  "no money"/"$0"/"broke" → true. But "free" followed by a time is their AVAILABILITY, not price:
  "free from 6 to 10" → false, "I'm free after 7" → false, "I'm free tonight" → false.
place — a neighborhood, city, venue or landmark they want to stay near ("downtown SLC", "Provo", "the U"). null if none.
stops — how many things they want to do, if they said ("a couple" → 2, "one thing" → 1). null if not said.`,
    prompt: `It is ${format(local, "EEEE, MMMM d, yyyy, h:mm a")} in Utah.\nTheir night: ${JSON.stringify(text)}`,
    schema: Intent,
  });
  if (intentCache.size >= 200) intentCache.delete(intentCache.keys().next().value!);
  intentCache.set(key, result);
  return result;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * No-AI reading of the request: the day ("tomorrow", "Saturday"), times ("6 to 10", "after 7", "until 11",
 * "afternoon") and "free" as in price ("free from 6" is about time, not price). The whole text becomes the interest.
 */
export function fallbackIntent(text: string, now: Date): Intent {
  const local = new TZDate(now, TIME_ZONE);
  const t = text.toLowerCase();

  let day = local;
  const named = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (/\btomorrow\b/.test(t)) day = addDays(local, 1);
  else if (named >= 0) day = addDays(local, (named - local.getDay() + 7) % 7);

  let [start, end] = /\bmorning\b/.test(t) ? [8, 12] : /\bafternoon\b/.test(t) ? [12, 18] : /\ball day\b/.test(t) ? [9, 24] : [17, 24];
  const morning = /\bmorning\b|\bam\b/.test(t);
  const hour = (h: string, m?: string, mer?: string) => {
    let n = Number(h) % 12;
    if (mer === "pm" || (!mer && !morning && n < 12 && Number(h) !== 12)) n += 12;
    if (Number(h) === 12 && mer !== "am") n = 12;
    return n + Number(m ?? 0) / 60;
  };
  const T = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
  const range = t.match(new RegExp(`${T}\\s*(?:to|-|–|until|till|til)\\s*${T}`));
  if (range) [start, end] = [hour(range[1], range[2], range[3]), hour(range[4], range[5], range[6])];
  else {
    const after = t.match(new RegExp(`(?:after|from|starting|at)\\s+${T}`));
    const until = t.match(new RegExp(`(?:until|till|til|by|before)\\s+${T}`));
    if (after) start = hour(after[1], after[2], after[3]);
    if (until) end = hour(until[1], until[2], until[3]);
  }
  if (/\bmidnight\b/.test(t)) end = 24;
  // "until 1" at night means 1 AM, not 1 PM (toWindow rolls an end before the start to the next day).
  if (end <= start && end >= 12 && end - 12 < 6) end -= 12;
  const hhmm = (h: number) => (h >= 24 ? "23:59" : `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`);

  return {
    date: format(day, "yyyy-MM-dd"),
    start: hhmm(start),
    end: hhmm(end),
    interests: [text.slice(0, 60)],
    categories: [],
    vibeTags: /\bkids?\b|\bfamily\b/.test(t) ? ["family-friendly"] : [],
    freeOnly: /\bfree\b(?!\s+(?:from|after|at|until|till|between|tonight|tomorrow|on|\d))/.test(t),
    place: null,
    stops: null,
  };
}

/** The intent's local date + times → a UTC window. An end at/before the start rolls to the next day; the past is cut off. */
function toWindow(i: Intent, now: Date): { from: Date; to: Date } {
  const pad = (t: string) => t.padStart(5, "0") + ":00";
  let from = new Date(utahLocalToIso(i.date, pad(i.start)));
  let to = new Date(utahLocalToIso(i.date, pad(i.end)));
  if (to <= from) to = new Date(to.getTime() + 24 * 3600e3);
  if (from < now) from = now;
  if (to <= from) to = new Date(from.getTime() + 4 * 3600e3);
  return { from, to };
}

// ── 2. Shortlist ─────────────────────────────────────────────────────────────

/**
 * Long listings aren't open the whole time they span. Calendars list "all day" things (library crafts, exhibits)
 * as midnight to 11:59 PM, and multi-day ones ("ScienceFest", Sat 10 AM – Sun 5 PM) as one long block, either of
 * which would let a plan send someone there at 11 PM. For planning, a listing of 12 h or more is open on the plan's
 * day from its listed start time to its listed end time (10 AM–7 PM when those are midnight or out of order).
 */
function withOpenHours(e: EventView, day: string): EventView {
  const start = new TZDate(e.startsAt, TIME_ZONE);
  const end = new TZDate(e.endsAt, TIME_ZONE);
  if (+end - +start < 12 * 3600e3) return e;
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
  let [openAt, closeAt] = [hhmm(start), hhmm(end)];
  if (openAt === "00:00:00" || closeAt <= openAt || closeAt >= "23:59:00") [openAt, closeAt] = ["10:00:00", "19:00:00"];
  const open = utahLocalToIso(day, openAt);
  const close = utahLocalToIso(day, closeAt);
  // ISO UTC strings compare lexically; stay inside the listing's own dates.
  return { ...e, startsAt: open > e.startsAt ? open : e.startsAt, endsAt: close < e.endsAt ? close : e.endsAt, endsAtEstimated: true };
}

interface Ranked {
  event: EventView;
  score: number;
  /** The interest phrase this event matched best, for the no-AI "why". */
  matched: string | null;
}

/** A show that started more than this long before they're free is already underway: not plannable. */
const UNDERWAY_MS = 15 * 60_000;

async function shortlist(i: Intent, window: { from: Date; to: Date }, point: { lat: number; lng: number } | null): Promise<Ranked[]> {
  const filters = FiltersSchema.parse({});
  if (i.freeOnly) filters.free = "1";
  if (point) Object.assign(filters, { lat: point.lat, lng: point.lng });

  const day = format(new TZDate(window.from, TIME_ZONE), "yyyy-MM-dd");
  const events = queryEvents(filters, { window }).map((e) => withOpenHours(e, day)).filter((e) => {
    const overlap = Math.min(+new Date(e.endsAt), +window.to) - Math.max(+new Date(e.startsAt), +window.from);
    // A concert that began at 11 AM can't be the plan for someone free from noon ("arrive an hour into the show").
    const underway = startsMatter(e) && +new Date(e.startsAt) < +window.from - UNDERWAY_MS;
    return overlap >= MIN_OVERLAP_MS && !underway && (e.distanceKm == null || !point || e.distanceKm <= PLACE_RADIUS_KM);
  });
  if (!events.length) return [];

  // Relevance: best match over each thing they asked for (embeddings; keywords when embeddings are unavailable).
  const relevance = new Map<string, { score: number; phrase: string }>();
  for (const phrase of i.interests.map((x) => x.toLowerCase().trim()).filter(Boolean)) {
    const scored = await score(phrase, events).catch(() => null);
    const byId = new Map(scored?.map((x) => [x.event.id, x.score]));
    for (const e of events) {
      const s = byId.get(e.id) ?? keywordScore(phrase, e);
      if (s > (relevance.get(e.id)?.score ?? -Infinity)) relevance.set(e.id, { score: s, phrase });
    }
  }

  const ranked = events.map((e) => {
    let s = relevance.get(e.id)?.score ?? 0.5;
    if (e.category && i.categories.includes(e.category)) s += 0.08;
    s += 0.03 * i.vibeTags.filter((v) => e.vibeTags.includes(v)).length;
    s += 0.04 * Math.min(1, Math.max(0, e.buzzScore ?? 0));
    if (e.distanceKm != null) s -= 0.004 * Math.max(0, e.distanceKm - 3);
    // Month-long exhibits overlap every window; a real happening tonight is usually the better pick.
    if (+new Date(e.endsAt) - +new Date(e.startsAt) > 12 * 3600e3) s -= 0.04;
    return { event: e, score: s, matched: relevance.get(e.id)?.phrase ?? null };
  });
  return ranked.sort((a, b) => b.score - a.score).slice(0, SHORTLIST);
}

const STOPWORDS = new Set(
  "the and for with want some something maybe then after before from near around tonight tomorrow night free like into what when where about just really have has my me i'm im our out fun thing things also".split(" "),
);

/** Without embeddings: share of the request's meaningful words found in the event (category name included). Range 0.3–0.7. */
function keywordScore(phrase: string, e: EventView): number {
  const words = phrase.split(/[^a-z0-9+&'-]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d/.test(w));
  if (!words.length) return 0.5;
  const text = `${e.title} ${e.summary} ${e.venueName ?? ""} ${e.category ? CATEGORY_LABELS[e.category] : ""}`.toLowerCase();
  return 0.3 + (0.4 * words.filter((w) => matchesKeywords(w, text)).length) / words.length;
}

// ── 3. Compose ───────────────────────────────────────────────────────────────

async function compose(request: string, i: Intent, window: { from: Date; to: Date }, events: EventView[], now: Date) {
  const list = events
    .map((e, n) => {
      const when = `${formatTime(e.startsAt)}–${formatTime(e.endsAt)}${e.endsAtEstimated ? " (end estimated)" : ""}`;
      const multiDay = +new Date(e.endsAt) - +new Date(e.startsAt) > 12 * 3600e3 ? " (ongoing, drop in any time it's open)" : "";
      const where = [e.venueName, e.address].filter(Boolean).join(", ") || "location unknown";
      const price = priceLabel(e.isFree, e.priceText) ?? "price unknown";
      const cat = e.category ? CATEGORY_LABELS[e.category] : "Other";
      return `${n + 1}. ${e.title} [${cat}] — ${format(new TZDate(e.startsAt, TIME_ZONE), "EEE")} ${when}${multiDay} — ${where} — ${price}\n   ${e.summary.slice(0, 200)}`;
    })
    .join("\n");

  const stops = i.stops ? `They want ${i.stops} stop${i.stops > 1 ? "s" : ""}.` : "Usually 2–3 stops; 1 is fine if one event fills the time.";
  return askAi({
    task: "plan-compose",
    maxTokens: 1500,
    timeoutMs: 25_000,
    system: `You plan someone's night out from a numbered list of real local events. Pick events that fit what they
described and chain them into a schedule that actually works:
- Stops are in time order and must not overlap. Leave travel time between venues in different areas
  (about 15 min within a neighborhood, 25–40 min between cities like Ogden, SLC, Provo).
- Stay inside their free window: ${formatTime(window.from.toISOString())} to ${formatTime(window.to.toISOString())}.
- arrive/leave are 24h "HH:MM" Utah time. Shows, concerts, games, talks: arrive 10–15 min BEFORE the listed start
  and stay to the end — never schedule arriving after a show has started. For drop-in or ongoing things,
  pick a sensible slice of time (45–90 min).
- Prefer variety and things that clearly match their words. Respect budget, audience and place.
- Try to fill a good part of their free time; don't leave long empty gaps when something fitting is available.
- ${stops}
- why: one or two sentences, friendly and specific, on why this stop fits them (no generic filler).
- title: a short catchy name for the night (max ~6 words). summary: 1–2 sentences on the flow of the night.
- backups: up to 4 other numbers from the list that would also fit, as swaps.
Only use numbers from the list. If nothing fits well, pick the closest thing and say so honestly in the summary.`,
    prompt: `It is ${format(new TZDate(now, TIME_ZONE), "EEEE, MMMM d, h:mm a")} in Utah.
Their night: ${JSON.stringify(request)}

Events (all overlap their window on ${format(new TZDate(window.from, TIME_ZONE), "EEEE, MMMM d")}):
${list}`,
    schema: Composed,
  });
}

// ── 4. Check & schedule ──────────────────────────────────────────────────────

type Draft = { event: EventView | undefined; arrive: string; leave: string; why: string };

/** Turns the AI's draft into a valid schedule: real times, inside the event and the window, no overlaps. */
function schedule(drafts: Draft[], window: { from: Date; to: Date }, date: string): Timed[] {
  const seen = new Set<string>();
  const timed = drafts
    .filter((d): d is Draft & { event: EventView } => !!d.event && !seen.has(d.event.id) && !!seen.add(d.event.id))
    .map((d) => {
      const start = +new Date(d.event.startsAt);
      // An estimated end ("ends around 10") is a guess; shows and gigs often run later, so it's a soft limit.
      const end = +new Date(d.event.endsAt) + (d.event.endsAtEstimated ? 90 * 60_000 : 0);
      const lo = Math.max(+window.from, start - 30 * 60_000);
      const hi = Math.min(+window.to, end);
      let arrive = clamp(atLocal(date, d.arrive, window) ?? Math.max(start, +window.from), lo, hi);
      // The model often gets show arithmetic wrong (arriving at 3:50 for a 3:00 show). Shortlisted shows haven't
      // started yet, so the fix is always the same: be there 10 minutes before the start.
      if (startsMatter(d.event) && arrive > start) arrive = Math.max(lo, start - 10 * 60_000);
      let leave = clamp(atLocal(date, d.leave, window) ?? hi, arrive, hi);
      // Too short to be worth it: keep the planned arrival and stay as long as the event allows (up to 90 min).
      if (leave - arrive < 20 * 60_000) leave = Math.min(hi, arrive + 90 * 60_000);
      return { event: d.event, why: d.why, arrive, leave };
    })
    .filter((s) => s.leave - s.arrive >= 20 * 60_000 && !(startsMatter(s.event) && s.arrive > +new Date(s.event.startsAt)))
    .sort((a, b) => a.arrive - b.arrive);

  const kept: Timed[] = [];
  for (const s of timed) {
    const prev = kept.at(-1);
    if (prev && s.arrive < prev.leave) {
      // Overlap: cut the earlier stop short only if it's a drop-in (never a show) with room to spare; otherwise drop this one.
      const prevStart = Math.max(+new Date(prev.event.startsAt), prev.arrive);
      if (s.arrive - prevStart >= 30 * 60_000 && isDropIn(prev.event)) prev.leave = s.arrive;
      else {
        console.warn(`[plan] dropped "${s.event.title}": overlaps "${prev.event.title}"`);
        continue;
      }
    }
    kept.push(s);
  }
  return kept.slice(0, MAX_STOPS);
}

const byArrive = (a: Timed, b: Timed) => a.arrive - b.arrive;

/**
 * Adds events from `pool`, best first, into the free time around `stops` until there are `wanted` stops.
 * Each addition keeps the drive to its neighbours, stays in the same area (≤ 30 min hops), arrives before a show
 * starts and stays at least 40 minutes at a drop-in. Used to plug a hole the time check left, and as the whole
 * scheduler when the AI is unavailable.
 */
function fillGaps(stops: Timed[], pool: Ranked[], window: { from: Date; to: Date }, wanted: number): Timed[] {
  const out = [...stops].sort(byArrive);
  for (const r of pool) {
    if (out.length >= wanted) break;
    const e = r.event;
    if (out.some((s) => s.event.id === e.id || (minutesBetween(s.event, e) ?? 0) > 30)) continue;
    const slot = place(e, out, window);
    if (!slot) continue;
    out.push({ event: e, why: reasonFor(r), ...slot });
    out.sort(byArrive);
  }
  return out;
}

/** The first gap in `stops` (time-ordered) that `e` fits into, with travel either side; null if none. */
function place(e: EventView, stops: Timed[], window: { from: Date; to: Date }): { arrive: number; leave: number } | null {
  const start = +new Date(e.startsAt);
  const end = +new Date(e.endsAt);
  const drive = (a: EventView, b: EventView) => (minutesBetween(a, b) ?? 15) * 60_000;
  for (let i = 0; i <= stops.length; i++) {
    const from = i === 0 ? +window.from : stops[i - 1].leave + drive(stops[i - 1].event, e);
    const to = i === stops.length ? +window.to : stops[i].arrive - drive(e, stops[i].event);
    if (startsMatter(e)) {
      const arrive = Math.max(from, start - 10 * 60_000);
      const leave = Math.min(end, to);
      // On time, and either the whole show or at least an hour of it.
      if (arrive <= start && leave >= Math.min(end, arrive + 60 * 60_000)) return { arrive, leave };
    } else {
      const arrive = Math.max(from, start);
      const leave = Math.min(end, to, arrive + 90 * 60_000);
      if (leave - arrive >= 40 * 60_000) return { arrive, leave };
    }
  }
  return null;
}

/**
 * Leaving a concert 45 minutes in only made sense for a next stop that has since been dropped. Shows run to their
 * end (or until it's time to drive to the next stop, or the window closes).
 */
function stayForShows(stops: Timed[], window: { from: Date; to: Date }): Timed[] {
  stops.forEach((s, n) => {
    if (!startsMatter(s.event)) return;
    const next = stops[n + 1];
    const drive = next ? (minutesBetween(s.event, next.event) ?? 15) * 60_000 : 0;
    const until = Math.min(+new Date(s.event.endsAt), +window.to, next ? next.arrive - drive : Infinity);
    if (until > s.leave) s.leave = until;
  });
  return stops;
}

type Timed = { event: EventView; why: string; arrive: number; leave: number };

/**
 * Makes room for the drive between stops where the schedule allows it: leave a drop-in earlier, or arrive at a
 * drop-in later, keeping at least 30 minutes at each. Shows keep their times; a gap that still can't fit the
 * drive is left for `withTravel` to flag as tight.
 */
function fitTravel(stops: Timed[]): Timed[] {
  const MIN_STAY = 30 * 60_000;
  for (let n = 1; n < stops.length; n++) {
    const [prev, s] = [stops[n - 1], stops[n]];
    const drive = minutesBetween(prev.event, s.event);
    if (drive == null) continue;
    let short = prev.leave + drive * 60_000 - s.arrive;
    if (short <= 0) continue;
    if (isDropIn(prev.event)) {
      const cut = Math.min(short, prev.leave - prev.arrive - MIN_STAY);
      if (cut > 0) [prev.leave, short] = [prev.leave - cut, short - cut];
    }
    if (short > 0 && isDropIn(s.event)) {
      const push = Math.min(short, s.leave - s.arrive - MIN_STAY);
      if (push > 0) s.arrive += push;
    }
  }
  return stops;
}

/** No-AI reason for a stop: what it matched and the practical bits, then the listing's own summary. */
function reasonFor(r: Ranked): string {
  const e = r.event;
  const bits = [r.matched && r.matched.length < 50 ? `Closest match for "${r.matched}"` : "A good fit for your window"];
  if (e.isFree) bits.push("free");
  if (e.venueName) bits.push(`at ${e.venueName}`);
  const first = e.summary.split(/(?<=[.!?])\s/)[0]?.slice(0, 160) ?? "";
  return `${bits.join(", ")}. ${first}`.trim();
}

/** Without AI: take the best-ranked events that fit around each other, then put them in time order. */
function greedy(ranked: Ranked[], window: { from: Date; to: Date }, wanted: number): PlanStop[] {
  return withTravel(fitTravel(fillGaps([], ranked, window, wanted)));
}

function withTravel(stops: Timed[]): PlanStop[] {
  return stops.map((s, n) => {
    const prev = stops[n - 1];
    const a = prev?.event;
    const travel =
      a && a.lat != null && a.lng != null && s.event.lat != null && s.event.lng != null
        ? driveEstimate(distanceM({ lat: a.lat, lng: a.lng }, { lat: s.event.lat, lng: s.event.lng }) / 1000)
        : null;
    return {
      event: s.event,
      why: s.why,
      arriveAt: new Date(s.arrive).toISOString(),
      leaveAt: new Date(s.leave).toISOString(),
      travel,
      tight: !!(prev && travel && s.arrive - prev.leave < travel.minutes * 60_000),
    };
  });
}

const minutesBetween = (a: EventView, b: EventView) =>
  a.lat != null && a.lng != null && b.lat != null && b.lng != null
    ? driveEstimate(distanceM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }) / 1000).minutes
    : null;

/** Rough Wasatch Front drive: ~1.3× straight-line distance at ~50 km/h, plus parking. Under 300 m is a walk. */
function driveEstimate(km: number): { km: number; minutes: number } {
  if (km < 0.3) return { km, minutes: 5 };
  return { km, minutes: Math.round((km * 1.3) / 50 * 60 + 8) };
}

/** Drop-in style: long, open-ended, or the end time is only an estimate. */
const isFlexible = (e: EventView) => e.endsAtEstimated || +new Date(e.endsAt) - +new Date(e.startsAt) > 4 * 3600e3;

/**
 * A show, game or talk: the start time matters (unlike markets, exhibits, open hours). Nightlife (club nights,
 * DJ sets, bar events) is left out: turning up an hour or two after doors is normal there.
 */
const SHOW_CATEGORIES = new Set(["music", "arts-culture", "sports", "learning-talks", "family"]);
const startsMatter = (e: EventView) =>
  !!e.category && SHOW_CATEGORIES.has(e.category) && +new Date(e.endsAt) - +new Date(e.startsAt) <= 5 * 3600e3;

/** Fine to leave early to make the next stop: open-ended things, not shows. */
const isDropIn = (e: EventView) => isFlexible(e) && !startsMatter(e);

/** "19:30" on the plan date, or the next day if that lands closer to the window (after-midnight times). */
function atLocal(date: string, hhmm: string, window: { from: Date; to: Date }): number | null {
  const [h, m] = hhmm.split(":").map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return null;
  const t = +new Date(utahLocalToIso(date, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`));
  const next = t + 24 * 3600e3;
  const dist = (x: number) => (x < +window.from ? +window.from - x : x > +window.to ? x - +window.to : 0);
  return dist(next) < dist(t) ? next : t;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), Math.max(lo, hi));

function fillBackups(chosen: EventView[], ranked: Ranked[], used: Set<string>): EventView[] {
  const out = [...chosen];
  for (const r of ranked) {
    if (out.length >= 4) break;
    if (!used.has(r.event.id) && !out.some((e) => e.id === r.event.id)) out.push(r.event);
  }
  return out.slice(0, 4);
}
