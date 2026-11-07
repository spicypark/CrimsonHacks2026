/**
 * Seeds the starting Wasatch Front source list. Idempotent: skips sources already present.
 * Usage: npm run seed
 *
 * Feed/page URLs are candidates — the first pipeline run marks any dead ones with last_error
 * in the admin view; disable or replace those.
 */
import { and, eq } from "drizzle-orm";
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
  { type: "webpage", target: "https://www.slcpl.org/events", label: "Salt Lake City Public Library" },
  { type: "webpage", target: "https://calendar.utah.edu/", label: "University of Utah calendar" },
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
console.log(`Seeded ${added} new sources (${SEED.length - added} already present).`);
