import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { cosine, embedOrNull, fromBlob, generateJson, toBlob } from "@/lib/ai/llm";
import { getDb, schema } from "@/lib/db/client";
import { matchesKeywords, type EventView } from "@/lib/events/query";
import { CATEGORY_LABELS } from "@/shared/event";

/**
 * Search words ("jazz", "board games") → the events that match them, kept in their original (time) order.
 *
 * Two stages, so it stays cheap as the event count grows:
 *  1. Retrieve: embedding cosine (+ a small exact-word bonus) shortlists the SHORTLIST closest events.
 *  2. Rerank: Gemini reads the shortlist and picks the events a person searching this would actually want.
 *     Embedding scores alone are too close together (match vs. non-match differ by ~0.02–0.05) for a fixed cutoff.
 *     Skipped when the embeddings already agree clearly (one event far ahead of the rest), which saves an AI call.
 * Fallbacks: AI rerank fails → keep events within FALLBACK_WINDOW of the best score; embeddings unavailable → keywords.
 */
const SHORTLIST = 20;
const KEYWORD_BONUS = 0.08;
const FALLBACK_WINDOW = 0.04;
/** A best score this high, leading the runner-up by CLEAR_GAP, is unambiguous ("board games" → Board Game Night). */
const CLEAR_SCORE = 0.62;
const CLEAR_GAP = 0.1;

const queryVectors = new Map<string, Float32Array>();
const rerankCache = new Map<string, Set<string>>();
const CACHE_MAX = 200;

/** Same text the pipeline embeds (src/pipeline/run.ts), so stored and backfilled vectors are comparable. */
const eventText = (e: Pick<EventView, "title" | "venueName" | "summary">) => `${e.title}. ${e.venueName ?? ""}. ${e.summary}`;

export interface Scored {
  event: EventView;
  score: number;
}

export async function semanticFilter(q: string, events: EventView[]): Promise<EventView[]> {
  const query = q.toLowerCase().trim();
  const scored = await score(query, events);
  if (!scored) return events.filter((e) => matchesKeywords(query, `${e.title} ${e.summary} ${e.venueName ?? ""} ${e.address ?? ""}`));
  if (!scored.length) return [];

  const shortlist = [...scored].sort((a, b) => b.score - a.score).slice(0, SHORTLIST);
  const [best, second] = shortlist;
  if (best.score >= CLEAR_SCORE && best.score - (second?.score ?? 0) >= CLEAR_GAP) {
    return events.filter((e) => e.id === best.event.id);
  }

  let keep: Set<string>;
  try {
    keep = await rerank(query, shortlist.map((s) => s.event));
  } catch (e) {
    console.error("[search] rerank failed, using embedding scores:", (e as Error).message.slice(0, 200));
    const best = shortlist[0].score;
    keep = new Set(shortlist.filter((s) => s.score >= best - FALLBACK_WINDOW).map((s) => s.event.id));
  }
  return events.filter((e) => keep.has(e.id));
}

/** Embedding similarity of every event to the query. Null when embeddings are unavailable (no key, quota used up). */
export async function score(query: string, events: EventView[]): Promise<Scored[] | null> {
  if (!events.length) return [];
  let qv = queryVectors.get(query);
  if (!qv) {
    const [v] = await embedOrNull([query], { interactive: true });
    if (!v) return null;
    qv = v;
    remember(queryVectors, query, v);
  }

  const vectors = await eventVectors(events);
  const words = query.split(/\s+/).filter((w) => w.length > 2);
  return events.map((event) => {
    const v = vectors.get(event.id);
    const text = `${event.title} ${event.summary} ${event.venueName ?? ""}`.toLowerCase();
    const hits = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
    return { event, score: (v ? cosine(qv, v) : 0) + KEYWORD_BONUS * hits };
  });
}

const Picked = z.object({ matches: z.array(z.number().int().min(1)) });

/** Asks the model which shortlisted events fit the search. Events are numbered so the model can't invent ids. */
async function rerank(query: string, shortlist: EventView[]): Promise<Set<string>> {
  const key = `${query}\n${shortlist.map((e) => e.id).sort().join(",")}`;
  const hit = rerankCache.get(key);
  if (hit) return hit;

  const list = shortlist
    .map((e, i) => `${i + 1}. ${e.title} [${e.category ? CATEGORY_LABELS[e.category] : "Other"}] — ${e.summary.slice(0, 220)}`)
    .join("\n");
  const { matches } = await generateJson({
    task: "rerank",
    interactive: true,
    system:
      "You filter a list of local events for a search. Return the numbers of the events someone typing this search " +
      "would want to see. Be strict: include an event only if it is clearly about the search topic, or is a close " +
      "substitute (\"basketball\" → an NBA game; \"jogging\" → a run club). Unrelated events must be left out, even if " +
      "they share a word. Return an empty list if nothing fits.",
    prompt: `Search: ${JSON.stringify(query)}\n\nEvents:\n${list}`,
    schema: Picked,
  });
  const keep = new Set(matches.filter((n) => n <= shortlist.length).map((n) => shortlist[n - 1].id));
  remember(rerankCache, key, keep);
  return keep;
}

/** Loads stored embeddings; embeds and saves any that are missing (e.g. sample data, or a run that hit quota). */
async function eventVectors(events: EventView[]): Promise<Map<string, Float32Array>> {
  const db = getDb();
  const e = schema.events;
  const rows = db
    .select({ id: e.id, embedding: e.embedding })
    .from(e)
    .where(inArray(e.id, events.map((x) => x.id)))
    .all();
  const out = new Map<string, Float32Array>();
  for (const r of rows) if (r.embedding) out.set(r.id, fromBlob(r.embedding));

  const missing = events.filter((x) => !out.has(x.id));
  if (missing.length) {
    const fresh = await embedOrNull(missing.map(eventText), { interactive: true });
    db.transaction((tx) => {
      missing.forEach((m, i) => {
        const v = fresh[i];
        if (!v) return;
        out.set(m.id, v);
        tx.update(e).set({ embedding: toBlob(v) }).where(eq(e.id, m.id)).run();
      });
    });
  }
  return out;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V) {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value!);
  map.set(key, value);
}
