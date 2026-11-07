import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import { getDb, schema } from "@/lib/db/client";
import { geocode, inRegion } from "@/lib/geo/geocode";
import { DEFAULT_DURATION_MS, type RawItem } from "@/shared/event";
import { connectors, type SourceRef } from "./connectors";
import { type CandidateEvent, enrichEvents, extractEvents } from "./extract";
import { createLogger, type Logger } from "./log";
import { type ReadyEvent, saveEvent } from "./merge";

export interface RunStats {
  sources: number;
  fetched: number;
  newItems: number;
  created: number;
  merged: number;
  dropped: number;
  errors: number;
}

const ENRICH_BATCH = 25;
const AI_CONCURRENCY = 3;

/** Runs the whole pipeline once: every enabled source (or the given ids) → fetch → extract → geocode → merge. */
export async function runPipeline(opts: { runId: number | null; sourceIds?: number[] }): Promise<RunStats> {
  const db = getDb();
  const log = createLogger(opts.runId);
  const stats: RunStats = { sources: 0, fetched: 0, newItems: 0, created: 0, merged: 0, dropped: 0, errors: 0 };

  const sources = db
    .select()
    .from(schema.sources)
    .where(eq(schema.sources.enabled, true))
    .all()
    .filter((s) => !opts.sourceIds || opts.sourceIds.includes(s.id));

  log.info("run", `Starting run over ${sources.length} sources`);
  for (const source of sources) {
    stats.sources++;
    try {
      await runSource(source, log, stats);
      db.update(schema.sources)
        .set({ lastCheckedAt: new Date().toISOString(), lastError: null })
        .where(eq(schema.sources.id, source.id))
        .run();
    } catch (e) {
      stats.errors++;
      const msg = (e as Error).message;
      log.error("fetch", `${source.label}: ${msg}`);
      db.update(schema.sources).set({ lastError: msg }).where(eq(schema.sources.id, source.id)).run();
    }
  }

  await backfillCoordinates(log);
  recomputeBuzz();
  log.info("run", "Run finished", stats);
  return stats;
}

async function runSource(source: SourceRef, log: Logger, stats: RunStats) {
  const db = getDb();
  log.info("fetch", `Fetching ${source.label}`, { type: source.type });
  const items = await connectors[source.type].fetch(source);
  stats.fetched += items.length;

  // Upsert raw items; engagement is refreshed on every run, AI work only for new/changed content.
  const todo: { item: RawItem; rowId: number; hash: string }[] = [];
  for (const item of items) {
    const hash = createHash("sha1").update(item.text).update(JSON.stringify(item.event)).digest("hex");
    const row = db
      .insert(schema.rawItems)
      .values({ sourceId: source.id, externalId: item.externalId, url: item.url, contentHash: hash, engagement: item.engagement })
      .onConflictDoUpdate({
        target: [schema.rawItems.sourceId, schema.rawItems.externalId],
        set: { contentHash: hash, engagement: item.engagement, url: item.url, fetchedAt: new Date().toISOString() },
      })
      .returning({ id: schema.rawItems.id, processedHash: schema.rawItems.processedHash })
      .get();
    if (row.processedHash !== hash) todo.push({ item, rowId: row.id, hash });
  }
  log.info("fetch", `${source.label}: ${items.length} items, ${todo.length} new or changed`);
  stats.newItems += todo.length;

  const markDone = (rowId: number, hash: string) =>
    db.update(schema.rawItems).set({ processedHash: hash }).where(eq(schema.rawItems.id, rowId)).run();

  // Structured items: enrich in batches, then save each batch together.
  const structured = todo.filter((t) => t.item.event);
  for (let i = 0; i < structured.length; i += ENRICH_BATCH) {
    const chunk = structured.slice(i, i + ENRICH_BATCH);
    try {
      const enriched = await enrichEvents(chunk.map((t) => t.item.event!));
      log.info("extract", `Tagged ${chunk.length} structured events from ${source.label}`);
      const pending: Pending[] = [];
      for (const [j, t] of chunk.entries()) {
        const c = enriched[j];
        const p = c ? await prepare(c, t.rowId, log, stats) : null;
        if (!c) stats.dropped++;
        if (p) pending.push(p);
      }
      await saveAll(pending, log, stats);
      for (const t of chunk) markDone(t.rowId, t.hash);
    } catch (e) {
      stats.errors++;
      log.error("extract", `Batch failed (will retry next run): ${(e as Error).message}`);
    }
  }

  // Unstructured items: AI extraction (calls are paced globally in the AI module).
  const limit = pLimit(AI_CONCURRENCY);
  await Promise.all(
    todo
      .filter((t) => !t.item.event)
      .map((t) =>
        limit(async () => {
          try {
            const found = await extractEvents(t.item);
            log.info("extract", found.length ? `Found ${found.length} event(s) in ${t.item.url}` : `No public event in ${t.item.url}`, {
              titles: found.map((f) => f.title),
            });
            if (!found.length) stats.dropped++;
            const pending: Pending[] = [];
            for (const c of found) {
              const p = await prepare(c, t.rowId, log, stats);
              if (p) pending.push(p);
            }
            await saveAll(pending, log, stats);
            markDone(t.rowId, t.hash);
          } catch (e) {
            stats.errors++;
            log.error("extract", `${t.item.url}: ${(e as Error).message}`);
          }
        }),
      ),
  );
}

interface Pending {
  event: ReadyEvent;
  rawItemId: number;
}

/** End-time estimate, drop finished events, geocode, and drop anything outside the Wasatch Front. */
async function prepare(c: CandidateEvent, rawItemId: number, log: Logger, stats: RunStats): Promise<Pending | null> {
  const start = new Date(c.startsAt).getTime();
  const estimatedEnd = !c.endsAt || new Date(c.endsAt).getTime() <= start;
  const endsAt = estimatedEnd
    ? new Date(start + DEFAULT_DURATION_MS[c.category ?? "community"]).toISOString()
    : new Date(c.endsAt!).toISOString();
  if (new Date(endsAt).getTime() < Date.now()) {
    stats.dropped++;
    return null;
  }

  if (c.lat == null || c.lng == null) {
    const queries = geocodeQueries(c.venueName, c.address);
    let p = null;
    for (const q of queries) if ((p = await geocode(q))) break;
    if (p) {
      log.info("geocode", `${c.title} → ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
      c = { ...c, lat: p.lat, lng: p.lng };
    } else log.warn("geocode", `Could not place "${c.title}" (${queries.join(" | ") || "no location"})`);
  }
  if (c.lat != null && c.lng != null && !inRegion({ lat: c.lat, lng: c.lng })) {
    stats.dropped++;
    log.warn("geocode", `Outside Wasatch Front, skipped: ${c.title}`);
    return null;
  }
  return { event: { ...c, startsAt: new Date(c.startsAt).toISOString(), endsAt, endsAtEstimated: estimatedEnd }, rawItemId };
}

/** Dedup-merges each event in the batch, in order. */
async function saveAll(pending: Pending[], log: Logger, stats: RunStats) {
  for (const { event: c, rawItemId } of pending) {
    const res = await saveEvent(c, rawItemId);
    if (res.mergedInto) {
      stats.merged++;
      log.info("merge", `Merged "${c.title}" into existing event (similarity ${res.similarity?.toFixed(2)})`, { eventId: res.eventId });
    } else {
      stats.created++;
      log.info("merge", `New event: ${c.title}`, { eventId: res.eventId });
    }
  }
}

/** Venue-name candidates for geocoding, most specific first. */
function geocodeQueries(venueName: string | null, address: string | null): string[] {
  return [
    ...new Set(
      [address, venueName && address && !address.includes(venueName) ? `${venueName}, ${address}` : null, venueName].filter(
        (q): q is string => !!q?.trim(),
      ),
    ),
  ];
}

/**
 * Retries upcoming events that still have no coordinates (geocoder improvements apply retroactively;
 * the cache keeps repeated misses free). Events stay listed either way; this only gets them on the map.
 */
async function backfillCoordinates(log: Logger) {
  const db = getDb();
  const missing = db
    .select({ id: schema.events.id, title: schema.events.title, venueName: schema.events.venueName, address: schema.events.address })
    .from(schema.events)
    .where(and(isNull(schema.events.lat), gt(schema.events.endsAt, new Date().toISOString())))
    .all();
  let fixed = 0;
  for (const e of missing) {
    let p = null;
    for (const q of geocodeQueries(e.venueName, e.address)) if ((p = await geocode(q))) break;
    if (p && inRegion(p)) {
      db.update(schema.events).set({ lat: p.lat, lng: p.lng }).where(eq(schema.events.id, e.id)).run();
      fixed++;
    }
  }
  if (missing.length) log.info("geocode", `Backfill: placed ${fixed} of ${missing.length} events missing coordinates`);
}

/**
 * buzz_score (0–100) = the event's best per-source-type percentile of engagement.
 * Engagement metric: Reddit upvotes + 2×comments; SeatGeek popularity. Sources without engagement contribute nothing.
 */
export function recomputeBuzz() {
  const db = getDb();
  const rows = db
    .select({ eventId: schema.eventSources.eventId, type: schema.sources.type, engagement: schema.rawItems.engagement })
    .from(schema.eventSources)
    .innerJoin(schema.rawItems, eq(schema.rawItems.id, schema.eventSources.rawItemId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.rawItems.sourceId))
    .all()
    .map((r) => ({
      ...r,
      metric:
        r.engagement.upvotes != null
          ? r.engagement.upvotes + 2 * (r.engagement.comments ?? 0)
          : r.engagement.popularity ?? null,
    }))
    .filter((r): r is typeof r & { metric: number } => r.metric != null);

  const best = new Map<string, number>();
  const byType = Map.groupBy(rows, (r) => r.type);
  for (const group of byType.values()) {
    const sorted = group.map((r) => r.metric).sort((a, b) => a - b);
    for (const r of group) {
      const pct = sorted.length === 1 ? 100 : (100 * sorted.lastIndexOf(r.metric)) / (sorted.length - 1);
      best.set(r.eventId, Math.max(best.get(r.eventId) ?? 0, pct));
    }
  }
  db.transaction((tx) => {
    tx.update(schema.events).set({ buzzScore: null }).run();
    for (const [id, score] of best) tx.update(schema.events).set({ buzzScore: Math.round(score) }).where(eq(schema.events.id, id)).run();
  });
}
