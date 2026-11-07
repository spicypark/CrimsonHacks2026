import { between, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { generateJson } from "@/lib/ai/llm";
import { getDb, schema } from "@/lib/db/client";
import { distanceM } from "@/lib/geo/geocode";
import type { CandidateEvent } from "./extract";

const WINDOW_MS = 3 * 3600e3;
const NEAR_M = 500;
const SAME = 0.85;
/** Titles of the same event vary across sources ("Jazz Night" vs "Jazz Night w/ The Trio"), so Haiku settles a wide band. */
const MAYBE = 0.5;

export interface ReadyEvent extends CandidateEvent {
  endsAt: string;
  endsAtEstimated: boolean;
}

const normVenue = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\bthe\b/g, "").trim();

function venuesMatch(a: string | null, b: string | null) {
  const x = normVenue(a);
  const y = normVenue(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Saves a candidate as a new event or merges it into an existing duplicate, and links the raw item.
 * Dedup: (1) block on ±3h start AND (≤500 m OR venue match), (2) similarity ≥ 0.85 = same,
 * (3) 0.5–0.85 → Claude Haiku tie-break. Similarity is title bigram overlap (Dice); the blocking step has
 * already narrowed candidates to the same place and time, so a loose title match there is worth asking about.
 */
export async function saveEvent(c: ReadyEvent, rawItemId: number): Promise<{ eventId: string; mergedInto: boolean; similarity?: number }> {
  const db = getDb();
  const t = new Date(c.startsAt).getTime();
  const nearby = db
    .select()
    .from(schema.events)
    .where(
      between(
        schema.events.startsAt,
        new Date(t - WINDOW_MS).toISOString(),
        new Date(t + WINDOW_MS).toISOString(),
      ),
    )
    .all()
    .filter((e) => {
      const close = c.lat != null && c.lng != null && e.lat != null && e.lng != null
        ? distanceM({ lat: c.lat, lng: c.lng }, { lat: e.lat, lng: e.lng }) <= NEAR_M
        : false;
      return close || venuesMatch(c.venueName, e.venueName);
    });

  let best: { row: (typeof nearby)[number]; sim: number } | null = null;
  for (const row of nearby) {
    const sim = titleSimilarity(c.title, row.title);
    if (!best || sim > best.sim) best = { row, sim };
  }

  const isDup = best && (best.sim >= SAME || (best.sim >= MAYBE && (await llmSaysSame(c, best.row))));

  if (best && isDup) {
    const e = best.row;
    db.update(schema.events)
      .set({
        summary: c.summary.length > e.summary.length ? c.summary : e.summary,
        description: c.description.length > e.description.length ? c.description : e.description,
        category: e.category ?? c.category,
        vibeTags: [...new Set([...e.vibeTags, ...c.vibeTags])],
        endsAt: e.endsAtEstimated && !c.endsAtEstimated ? c.endsAt : e.endsAt,
        endsAtEstimated: e.endsAtEstimated && c.endsAtEstimated,
        venueName: e.venueName ?? c.venueName,
        address: e.address ?? c.address,
        lat: e.lat ?? c.lat,
        lng: e.lng ?? c.lng,
        isFree: e.isFree ?? c.isFree,
        priceText: e.priceText ?? c.priceText,
        imageUrl: e.imageUrl ?? c.imageUrl,
        confidence: Math.max(e.confidence, c.confidence),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.events.id, e.id))
      .run();
    link(e.id, rawItemId);
    return { eventId: e.id, mergedInto: true, similarity: best.sim };
  }

  const id = nanoid(12);
  db.insert(schema.events)
    .values({
      id,
      title: c.title,
      summary: c.summary,
      description: c.description,
      category: c.category,
      vibeTags: c.vibeTags,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      endsAtEstimated: c.endsAtEstimated,
      venueName: c.venueName,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      isFree: c.isFree,
      priceText: c.priceText,
      imageUrl: c.imageUrl,
      confidence: c.confidence,
    })
    .run();
  link(id, rawItemId);
  return { eventId: id, mergedInto: false };
}

/** Dice coefficient over character bigrams of normalized titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const out = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const x = grams(a);
  const y = grams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of x) {
    overlap += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

function link(eventId: string, rawItemId: number) {
  getDb().insert(schema.eventSources).values({ eventId, rawItemId }).onConflictDoNothing().run();
}

async function llmSaysSame(c: ReadyEvent, e: typeof schema.events.$inferSelect): Promise<boolean> {
  try {
    const { same } = await generateJson({
      task: "dedupe",
      system: "You decide whether two event listings describe the exact same real-world event (same thing, same place, same day).",
      schema: z.object({ same: z.boolean() }),
      prompt: `A: ${c.title} | ${c.startsAt} | ${c.venueName ?? "?"}\n${c.summary}\n\nB: ${e.title} | ${e.startsAt} | ${e.venueName ?? "?"}\n${e.summary}`,
    });
    return same;
  } catch {
    return false; // when unsure, keep them separate
  }
}
