/**
 * Seeds the starting Wasatch Front source list. Idempotent: skips sources already present.
 * Usage: npm run seed
 *
 * Feed/page URLs are candidates — the first pipeline run marks any dead ones with last_error
 * in the admin view; disable or replace those.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { SourceType } from "@/shared/event";

const SEED: { type: SourceType; target: string; label: string }[] = [
  { type: "ticketmaster", target: "", label: "Ticketmaster (60 mi of SLC)" },
  { type: "seatgeek", target: "", label: "SeatGeek (60 mi of SLC)" },
  { type: "reddit", target: "SaltLakeCity", label: "r/SaltLakeCity" },
  { type: "reddit", target: "Utah", label: "r/Utah" },
  { type: "reddit", target: "slc", label: "r/slc" },
  { type: "reddit", target: "uofu", label: "r/uofu" },
  { type: "reddit", target: "Provo", label: "r/Provo" },
  { type: "webpage", target: "https://www.visitsaltlake.com/events/", label: "Visit Salt Lake events" },
  // Verified 2026-11-06: University of Utah publishes its events calendar through Trumba.
  { type: "ical", target: "https://www.trumba.com/calendars/university-of-utah.ics", label: "University of Utah events" },
  // Both library systems run Communico calendars with a public JSON feed.
  { type: "communico", target: "https://slcpl.libnet.info", label: "Salt Lake City Public Library" },
  { type: "communico", target: "https://slcls.libnet.info", label: "Salt Lake County Library" },
];

/** Sources that turned out not to work; disabled (not deleted) so their history stays in the admin view. */
const RETIRED = [
  "https://www.slcpl.org/events", // page renders events client-side; replaced by the Communico feed
  "https://calendar.utah.edu/", // host no longer resolves; replaced by the Trumba feed
];

const db = getDb();
let added = 0;
for (const s of SEED) {
  const exists = db
    .select()
    .from(schema.sources)
    .where(and(eq(schema.sources.type, s.type), eq(schema.sources.target, s.target)))
    .get();
  if (!exists) {
    db.insert(schema.sources).values(s).run();
    added++;
  }
}
const retired = db.update(schema.sources).set({ enabled: false }).where(inArray(schema.sources.target, RETIRED)).run().changes;
console.log(`Seeded ${added} new sources (${SEED.length - added} already present); disabled ${retired} retired.`);
