import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import pLimit from "p-limit";
import { embed } from "@/lib/ai/llm";
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

const ENRICH_BATCH = 10;
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

  // Structured items: enrich in batches.
  const structured = todo.filter((t) => t.item.event);
  for (let i = 0; i < structured.length; i += ENRICH_BATCH) {
    const chunk = structured.slice(i, i + ENRICH_BATCH);
    try {
      const enriched = await enrichEvents(chunk.map((t) => t.item.event!));
      log.info("extract", `Tagged ${chunk.length} structured events from ${source.label}`);
      for (const [j, t] of chunk.entries()) {
        const c = enriched[j];
        if (c) await finalizeAndSave(c, t.rowId, log, stats);
        else stats.dropped++;
        markDone(t.rowId, t.hash);
      }
    } catch (e) {
      stats.errors++;
      log.error("extract", `Enrichment failed: ${(e as Error).message}`);
    }
  }

  // Unstructured items: AI extraction, a few at a time.
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
            for (const c of found) await finalizeAndSave(c, t.rowId, log, stats);
            markDone(t.rowId, t.hash);
          } catch (e) {
            stats.errors++;
            log.error("extract", `${t.item.url}: ${(e as Error).message}`);
          }
        }),
      ),
  );
}

async function finalizeAndSave(c: CandidateEvent, rawItemId: number, log: Logger, stats: RunStats) {
  const start = new Date(c.startsAt).getTime();
  const estimatedEnd = !c.endsAt || new Date(c.endsAt).getTime() <= start;
  const endsAt = estimatedEnd
    ? new Date(start + DEFAULT_DURATION_MS[c.category ?? "community"]).toISOString()
    : c.endsAt!;
  if (new Date(endsAt).getTime() < Date.now()) {
    stats.dropped++;
    return;
  }

  if (c.lat == null || c.lng == null) {
    const query = [c.venueName, c.address].filter(Boolean).join(", ");
    const p = query ? await geocode(query) : null;
    if (p) {
      log.info("geocode", `${c.title} → ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`);
      c = { ...c, lat: p.lat, lng: p.lng };
    } else log.warn("geocode", `Could not place "${c.title}" (${query || "no location"})`);
  }
  if (c.lat != null && c.lng != null && !inRegion({ lat: c.lat, lng: c.lng })) {
    stats.dropped++;
    log.warn("geocode", `Outside Wasatch Front, skipped: ${c.title}`);
    return;
  }

  const [embedding] = await embed([`${c.title}. ${c.venueName ?? ""}. ${c.summary}`]);
  const ready: ReadyEvent = { ...c, endsAt, endsAtEstimated: estimatedEnd, embedding };
  const res = await saveEvent(ready, rawItemId);
  if (res.mergedInto) {
    stats.merged++;
    log.info("merge", `Merged "${c.title}" into existing event (similarity ${res.similarity?.toFixed(2)})`, { eventId: res.eventId });
  } else {
    stats.created++;
    log.info("merge", `New event: ${c.title}`, { eventId: res.eventId });
  }
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
