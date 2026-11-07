/**
 * DEVELOPMENT ONLY: fills the DB with clearly-labelled sample events so the UI can be built before
 * API keys exist. Sample sources are disabled (the pipeline never fetches them) and their labels
 * say "Sample data". Remove everything with:  npm run seed:demo -- --clear
 * Never leave sample data in the production DB.
 */
import { inArray, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db/client";
import { recomputeBuzz } from "@/pipeline/run";
import type { Category, Engagement, SourceType, VibeTag } from "@/shared/event";

const db = getDb();
const SAMPLE_PREFIX = "sample://";

function clear() {
  const sources = db.select().from(schema.sources).where(like(schema.sources.target, `${SAMPLE_PREFIX}%`)).all();
  const sourceIds = sources.map((s) => s.id);
  if (!sourceIds.length) return 0;
  const raws = db.select().from(schema.rawItems).where(inArray(schema.rawItems.sourceId, sourceIds)).all();
  const rawIds = raws.map((r) => r.id);
  const links = rawIds.length
    ? db.select().from(schema.eventSources).where(inArray(schema.eventSources.rawItemId, rawIds)).all()
    : [];
  const eventIds = [...new Set(links.map((l) => l.eventId))];
  db.transaction((tx) => {
    if (eventIds.length) tx.delete(schema.events).where(inArray(schema.events.id, eventIds)).run(); // cascades links
    if (rawIds.length) tx.delete(schema.rawItems).where(inArray(schema.rawItems.id, rawIds)).run();
    tx.delete(schema.sources).where(inArray(schema.sources.id, sourceIds)).run();
  });
  return eventIds.length;
}

if (process.argv.includes("--clear")) {
  console.log(`Removed ${clear()} sample events.`);
  process.exit(0);
}
clear();

const sampleSource = (type: SourceType, name: string) =>
  db.insert(schema.sources).values({ type, target: `${SAMPLE_PREFIX}${name}`, label: `Sample data (${name})`, enabled: false }).returning().get().id;

const redditSrc = sampleSource("reddit", "reddit");
const calSrc = sampleSource("ical", "calendar");
const tmSrc = sampleSource("ticketmaster", "tickets");

const H = 3600e3;
const today = new Date();
today.setHours(0, 0, 0, 0);
const at = (dayOffset: number, hour: number, min = 0) => new Date(today.getTime() + dayOffset * 24 * H + (hour + min / 60) * H);

interface Sample {
  title: string;
  summary: string;
  category: Category;
  vibe: VibeTag[];
  start: Date;
  hours: number;
  estimated?: boolean;
  venue: string;
  address: string;
  lat: number;
  lng: number;
  free: boolean | null;
  price?: string;
  sources: { src: number; engagement: Engagement }[];
  confidence?: number;
}

const nowH = new Date().getHours();
const samples: Sample[] = [
  { title: "Evening Social Run Club", summary: "A social 5K loop around the park at conversational pace, then drinks nearby. All paces welcome; nobody gets left behind.", category: "running-fitness", vibe: ["free", "beginner-friendly", "meet-people", "go-solo"], start: at(0, Math.max(nowH - 1, 0)), hours: 2, venue: "Liberty Park", address: "600 E 900 S, Salt Lake City, UT", lat: 40.7457, lng: -111.8746, free: true, sources: [{ src: redditSrc, engagement: { upvotes: 214, comments: 38 } }, { src: calSrc, engagement: {} }] },
  { title: "Open Mic at the Library Plaza", summary: "Five-minute slots for music, poetry or comedy. Sign up at the door from 6:30. Audience totally welcome too.", category: "arts-culture", vibe: ["free", "chill", "go-solo"], start: at(0, 19), hours: 2.5, venue: "Salt Lake City Main Library", address: "210 E 400 S, Salt Lake City, UT", lat: 40.7614, lng: -111.8836, free: true, sources: [{ src: calSrc, engagement: {} }] },
  { title: "Indie Night: Three Local Bands", summary: "Three Salt Lake indie bands on one bill. All ages; bring ID if you want a wristband for the bar.", category: "music", vibe: ["high-energy", "meet-people"], start: at(0, 20), hours: 3, venue: "Kilby Court", address: "741 S Kilby Ct, Salt Lake City, UT", lat: 40.7542, lng: -111.8999, free: false, price: "$12", sources: [{ src: tmSrc, engagement: {} }, { src: redditSrc, engagement: { upvotes: 56, comments: 9 } }] },
  { title: "Bouldering Meetup for Beginners", summary: "Staff-led intro session; shoe rental included with a day pass. Great if you've never climbed.", category: "climbing", vibe: ["beginner-friendly", "meet-people", "student"], start: at(0, 18, 30), hours: 2, venue: "The Front Climbing Club", address: "1450 S 400 W, Salt Lake City, UT", lat: 40.7395, lng: -111.9035, free: false, price: "$22 day pass", sources: [{ src: redditSrc, engagement: { upvotes: 88, comments: 21 } }] },
  { title: "Winter Farmers Market", summary: "Utah growers, bakers and makers indoors. Bring a bag; many vendors take cash only.", category: "markets", vibe: ["free", "family-friendly", "dog-friendly"], start: at(1, 10), hours: 4, venue: "Rio Grande Depot", address: "300 S Rio Grande St, Salt Lake City, UT", lat: 40.7618, lng: -111.9046, free: true, sources: [{ src: calSrc, engagement: {} }, { src: redditSrc, engagement: { upvotes: 143, comments: 17 } }] },
  { title: "Sunset Hike up Ensign Peak", summary: "Short, steep hike with city views at golden hour. Bring a headlamp for the walk down.", category: "outdoors", vibe: ["free", "outdoorsy", "meet-people", "dog-friendly"], start: at(1, 16, 15), hours: 1.5, venue: "Ensign Peak Trailhead", address: "Ensign Vista Dr, Salt Lake City, UT", lat: 40.7928, lng: -111.8889, free: true, sources: [{ src: redditSrc, engagement: { upvotes: 61, comments: 14 } }] },
  { title: "Utah Jazz vs. Denver", summary: "NBA regular-season game downtown. Tickets on resale sites vary widely in price.", category: "sports", vibe: ["high-energy"], start: at(1, 19), hours: 3, venue: "Delta Center", address: "301 S Temple, Salt Lake City, UT", lat: 40.7683, lng: -111.9011, free: false, price: "$38–$410", sources: [{ src: tmSrc, engagement: {} }] },
  { title: "Board Game Night", summary: "Hundreds of games on the shelves and volunteers who'll teach you the rules. Drop in any time.", category: "community", vibe: ["free", "chill", "go-solo", "meet-people"], start: at(1, 18), hours: 4, estimated: true, venue: "Sugar House Library", address: "2131 S 1100 E, Salt Lake City, UT", lat: 40.7247, lng: -111.8582, free: true, sources: [{ src: redditSrc, engagement: { upvotes: 37, comments: 6 } }] },
  { title: "Holiday Lights Walk", summary: "Opening night of the garden's light displays, with cocoa stands along the path.", category: "family", vibe: ["family-friendly", "outdoorsy"], start: at(2, 17), hours: 4, venue: "Red Butte Garden", address: "300 Wakara Way, Salt Lake City, UT", lat: 40.7665, lng: -111.824, free: false, price: "$18", sources: [{ src: calSrc, engagement: {} }] },
  { title: "Saturday Food Truck Rally", summary: "Fifteen trucks, picnic tables, and a DJ. Free to walk in; you pay per truck.", category: "food-drink", vibe: ["free", "family-friendly", "meet-people"], start: at(2, 11), hours: 5, venue: "Gallivan Center", address: "239 S Main St, Salt Lake City, UT", lat: 40.7653, lng: -111.8901, free: true, sources: [{ src: redditSrc, engagement: { upvotes: 302, comments: 44 } }, { src: calSrc, engagement: {} }, { src: tmSrc, engagement: {} }] },
  { title: "25th Street Art Stroll", summary: "Galleries along Historic 25th Street stay open late with artists on hand.", category: "arts-culture", vibe: ["free", "chill", "go-solo"], start: at(2, 18), hours: 3, venue: "Historic 25th Street", address: "25th St, Ogden, UT", lat: 41.2203, lng: -111.9718, free: true, sources: [{ src: calSrc, engagement: {} }] },
  { title: "Provo Pickup Ultimate", summary: "Casual pickup frisbee; bring a light and a dark shirt. Rain or shine.", category: "sports", vibe: ["free", "beginner-friendly", "student", "meet-people"], start: at(3, 13), hours: 2, estimated: true, venue: "Pioneer Park", address: "500 W Center St, Provo, UT", lat: 40.2345, lng: -111.6627, free: true, sources: [{ src: redditSrc, engagement: { upvotes: 19, comments: 4 } }] },
  { title: "Comedy Showcase", summary: "Local comics try new material. 21+, two-drink minimum.", category: "nightlife", vibe: ["21-plus", "high-energy"], start: at(3, 21), hours: 2, venue: "Wiseguys Comedy", address: "194 S 400 W, Salt Lake City, UT", lat: 40.7642, lng: -111.9024, free: false, price: "$15", sources: [{ src: tmSrc, engagement: {} }] },
  { title: "Someone said there's a rave at the lake?", summary: "A vague post mentioning a possible gathering near the Great Salt Lake marina. No organizer or confirmed time.", category: "nightlife", vibe: ["high-energy"], start: at(2, 22), hours: 3, estimated: true, venue: "Great Salt Lake State Park", address: "Magna, UT", lat: 40.7356, lng: -112.2105, free: null, sources: [{ src: redditSrc, engagement: { upvotes: 7, comments: 12 } }], confidence: 0.4 },
];

let n = 0;
for (const s of samples) {
  const id = nanoid(12);
  db.insert(schema.events)
    .values({
      id, title: s.title, summary: s.summary, description: "", category: s.category, vibeTags: s.vibe,
      startsAt: s.start.toISOString(), endsAt: new Date(s.start.getTime() + s.hours * H).toISOString(),
      endsAtEstimated: !!s.estimated, venueName: s.venue, address: s.address, lat: s.lat, lng: s.lng,
      isFree: s.free, priceText: s.price ?? (s.free ? "Free" : null), imageUrl: null,
      confidence: s.confidence ?? 0.95,
    })
    .run();
  for (const [i, src] of s.sources.entries()) {
    const raw = db
      .insert(schema.rawItems)
      .values({ sourceId: src.src, externalId: `${id}-${i}`, url: "https://example.com/sample-event", contentHash: "sample", processedHash: "sample", engagement: src.engagement })
      .returning()
      .get();
    db.insert(schema.eventSources).values({ eventId: id, rawItemId: raw.id }).run();
  }
  n++;
}

recomputeBuzz(); // so "Most popular" sorting works on sample data too
console.log(`Inserted ${n} sample events. Remove with: npm run seed:demo -- --clear`);
