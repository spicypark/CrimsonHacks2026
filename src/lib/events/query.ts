import { and, eq, gt, gte, inArray, lt, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { distanceM } from "@/lib/geo/geocode";
import type { Category, Engagement, SourceType, VibeTag } from "@/shared/event";
import { type Filters, NEAR_RADIUS_KM, timeWindow } from "./filters";

import { CONFIDENCE_THRESHOLD } from "./format";
export { CONFIDENCE_THRESHOLD };

export interface EventSourceView {
  type: SourceType;
  label: string;
  url: string;
  engagement: Engagement;
  lastCheckedAt: string;
}

/** Everything the list card, map pin and detail page need. Serializable (safe to pass to client components). */
export interface EventView {
  id: string;
  title: string;
  summary: string;
  description: string;
  category: Category | null;
  vibeTags: VibeTag[];
  startsAt: string;
  endsAt: string;
  endsAtEstimated: boolean;
  venueName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  isFree: boolean | null;
  priceText: string | null;
  imageUrl: string | null;
  confidence: number;
  buzzScore: number | null;
  status: "active" | "cancelled" | "changed";
  sources: EventSourceView[];
  distanceKm: number | null;
}

/**
 * The one place event filtering and sorting lives — used by the list, the map, NL search and the API.
 * `ids` optionally restricts (and orders, for search relevance) the result.
 */
export function queryEvents(
  f: Filters,
  opts: { ids?: string[]; now?: Date; /** Exact [from, to) window; overrides `f.when`. */ window?: { from: Date; to: Date } } = {},
): EventView[] {
  const db = getDb();
  const { from, to } = opts.window ?? timeWindow(f.when, opts.now);
  const e = schema.events;

  const conditions = [
    lt(e.startsAt, to.toISOString()), // starts before window ends
    gt(e.endsAt, from.toISOString()), // ends after window starts
    ne(e.status, "cancelled"),
    f.maybe ? lt(e.confidence, CONFIDENCE_THRESHOLD) : gte(e.confidence, CONFIDENCE_THRESHOLD),
  ];
  if (f.cat.length) conditions.push(inArray(e.category, f.cat));
  if (f.free) conditions.push(eq(e.isFree, true));
  if (opts.ids) conditions.push(inArray(e.id, opts.ids.length ? opts.ids : ["__none__"]));

  const rows = db
    .select({
      id: e.id, title: e.title, summary: e.summary, description: e.description, category: e.category,
      vibeTags: e.vibeTags, startsAt: e.startsAt, endsAt: e.endsAt, endsAtEstimated: e.endsAtEstimated,
      venueName: e.venueName, address: e.address, lat: e.lat, lng: e.lng, isFree: e.isFree,
      priceText: e.priceText, imageUrl: e.imageUrl, confidence: e.confidence, buzzScore: e.buzzScore,
      status: e.status, createdAt: e.createdAt,
    })
    .from(e)
    .where(and(...conditions))
    .all()
    .filter((r) => f.vibe.every((v) => r.vibeTags.includes(v)))
    .filter((r) => matchesKeywords(f.q, `${r.title} ${r.summary} ${r.venueName ?? ""} ${r.address ?? ""}`));

  const sources = sourcesFor(rows.map((r) => r.id));
  const here = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null;

  const views = rows
    .map(({ createdAt, ...r }) => ({
      ...r,
      createdAt,
      sources: sources.get(r.id) ?? [],
      distanceKm: here && r.lat != null && r.lng != null ? distanceM(here, { lat: r.lat, lng: r.lng }) / 1000 : null,
    }))
    // A named place ("near Sugar House") is a hard radius; plain lat/lng (sort by nearest) is not.
    .filter((v) => !(f.near && here) || (v.distanceKm != null && v.distanceKm <= NEAR_RADIUS_KM));

  const bySoon = (a: (typeof views)[number], b: (typeof views)[number]) => a.startsAt.localeCompare(b.startsAt);
  if (opts.ids) {
    const rank = new Map(opts.ids.map((id, i) => [id, i]));
    views.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  } else if (f.sort === "popular") views.sort((a, b) => (b.buzzScore ?? -1) - (a.buzzScore ?? -1) || bySoon(a, b));
  else if (f.sort === "near" && here) views.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  else if (f.sort === "new") views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else views.sort(bySoon);

  return views.map(({ createdAt: _, ...v }) => v);
}

/** Plain keyword match (every word must appear). Used when Claude is unavailable. */
export { matchesKeywords };
function matchesKeywords(q: string | undefined, haystack: string): boolean {
  if (!q) return true;
  const text = haystack.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

export function getEvent(id: string): EventView | null {
  const row = getDb().select().from(schema.events).where(eq(schema.events.id, id)).get();
  if (!row) return null;
  const { embedding: _e, createdAt: _c, updatedAt: _u, ...r } = row;
  return { ...r, sources: sourcesFor([id]).get(id) ?? [], distanceKm: null };
}

function sourcesFor(eventIds: string[]): Map<string, EventSourceView[]> {
  const out = new Map<string, EventSourceView[]>();
  if (!eventIds.length) return out;
  const rows = getDb()
    .select({
      eventId: schema.eventSources.eventId,
      type: schema.sources.type,
      label: schema.sources.label,
      url: schema.rawItems.url,
      engagement: schema.rawItems.engagement,
      lastCheckedAt: schema.rawItems.fetchedAt,
    })
    .from(schema.eventSources)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.eventSources.rawItemId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.rawItems.sourceId))
    .where(inArray(schema.eventSources.eventId, eventIds))
    .all();
  for (const { eventId, ...s } of rows) out.set(eventId, [...(out.get(eventId) ?? []), s]);
  return out;
}
