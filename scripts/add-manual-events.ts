/**
 * Adds hand-picked events (found on the web) for categories the scrapers leave thin.
 * Idempotent: re-running updates the same rows. Run: tsx --env-file-if-exists=.env.local scripts/add-manual-events.ts
 * Times are Utah local (MST, UTC−7, in November/December).
 */
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db/client";
import { geocode } from "@/lib/geo/geocode";
import type { Category, VibeTag } from "@/shared/event";

const MANUAL_TARGET = "manual";

interface ManualEvent {
  key: string;
  url: string;
  title: string;
  summary: string;
  category: Category;
  vibeTags: VibeTag[];
  /** Local Utah time, "YYYY-MM-DDTHH:mm". */
  start: string;
  end: string;
  endEstimated?: boolean;
  venueName: string;
  address: string;
  isFree: boolean | null;
  priceText: string | null;
  confidence: number;
}

const EVENTS: ManualEvent[] = [
  // Markets
  {
    key: "holiday-trunk-show-2026-11-07",
    url: "https://saltycityexchange.com/market-dates-1",
    title: "Holiday Season Trunk Show",
    summary: "Salty City Exchange's local makers market at The Hearth, ahead of holiday shopping season.",
    category: "markets",
    vibeTags: ["chill", "go-solo"],
    start: "2026-11-07T10:00",
    end: "2026-11-07T14:00",
    venueName: "The Hearth",
    address: "1186 S Main St, Salt Lake City, UT 84101",
    isFree: null,
    priceText: null,
    confidence: 0.85,
  },
  {
    key: "jcc-hanukkah-market-2026",
    url: "https://www.slcjcc.org/pages/events-hanukkah-market/",
    title: "Hanukkah Market",
    summary: "Free holiday market with handmade goods from 40+ artists and makers, plus food and kids' activities.",
    category: "markets",
    vibeTags: ["free", "family-friendly", "chill"],
    start: "2026-11-08T12:00",
    end: "2026-11-08T17:00",
    venueName: "IJ & Jeanné Wagner Jewish Community Center",
    address: "2 N Medical Dr, Salt Lake City, UT 84113",
    isFree: true,
    priceText: "Free",
    confidence: 0.95,
  },
  {
    key: "family-christmas-gift-show-2026",
    url: "https://nowplayingutah.com/event/salt-lakes-family-christmas-gift-show-2026/",
    title: "Salt Lake's Family Christmas Gift Show",
    summary: "450+ booths of gifts, décor and treats, with Santa's Village, live entertainment and a 50-foot light tunnel. Runs Nov 12–14.",
    category: "markets",
    vibeTags: ["family-friendly"],
    start: "2026-11-12T10:00",
    end: "2026-11-14T21:00",
    venueName: "Mountain America Expo Center",
    address: "9575 S State St, Sandy, UT 84070",
    isFree: false,
    priceText: "$18 (13 and under free)",
    confidence: 0.95,
  },
  // Nightlife
  {
    key: "salsation-utah-2026-11-07",
    url: "https://www.salsavida.com/event/utah/salt-lake-city/salsation-utah/",
    title: "Salsation Utah: Salsa & Bachata Social",
    summary: "Salsa lesson followed by a salsa and bachata social dance. No partner needed.",
    category: "nightlife",
    vibeTags: ["high-energy", "meet-people", "beginner-friendly"],
    start: "2026-11-07T21:00",
    end: "2026-11-08T01:30",
    venueName: "Athena VII",
    address: "111 W 9000 S, Sandy, UT 84070",
    isFree: false,
    priceText: "$12–$15 ($8 with college ID)",
    confidence: 0.8,
  },
  {
    key: "karamba-tropical-nights-2026-11-13",
    url: "https://www.salsavida.com/event/utah/salt-lake-city/friday-tropical-nights-at-club-karamba/",
    title: "Friday Tropical Nights at Club Karamba",
    summary: "Weekly salsa and bachata night. 21+, free before 10:30 PM.",
    category: "nightlife",
    vibeTags: ["21-plus", "high-energy", "meet-people"],
    start: "2026-11-13T22:00",
    end: "2026-11-14T02:00",
    venueName: "Club Karamba",
    address: "1051 E 2100 S, Salt Lake City, UT 84106",
    isFree: null,
    priceText: "Free before 10:30 PM",
    confidence: 0.8,
  },
  {
    key: "havana-on-state-2026-11-13",
    url: "https://www.salsavida.com/event/utah/salt-lake-city/havana-on-state-salsa-bachata-social/",
    title: "Havana on State: Salsa & Bachata Social",
    summary: "Beginner class at 9, then salsa, bachata and cumbia rooms until 1:30. No partner needed, all levels.",
    category: "nightlife",
    vibeTags: ["high-energy", "meet-people", "beginner-friendly", "go-solo"],
    start: "2026-11-13T21:00",
    end: "2026-11-14T01:30",
    venueName: "DF Dance Studio",
    address: "2978 S State St, Salt Lake City, UT 84115",
    isFree: false,
    priceText: "$12–$15",
    confidence: 0.85,
  },
  {
    key: "friyay-latin-social-2026-11-06",
    url: "https://www.salsavida.com/event/utah/salt-lake-city/friyay-latin-dance-social/",
    title: "FriYAY! Latin Dance Social",
    summary: "Utah Salsa's first-Friday salsa lesson and salsa & bachata social.",
    category: "nightlife",
    vibeTags: ["high-energy", "meet-people", "beginner-friendly"],
    start: "2026-11-06T22:00",
    end: "2026-11-07T01:30",
    venueName: "Utah Salsa",
    address: "3030 S Main St, Salt Lake City, UT 84115",
    isFree: false,
    priceText: "$15",
    confidence: 0.75,
  },
  {
    key: "blue-genes-drag-karaoke-2026-11-07",
    url: "https://www.bluegenesslc.com/events",
    title: "Drag Karaoke with Hysteria",
    summary: "Saturday drag karaoke night at Blue Gene's, next to Urban Lounge.",
    category: "nightlife",
    vibeTags: ["21-plus", "high-energy", "meet-people"],
    start: "2026-11-07T21:00",
    end: "2026-11-08T01:00",
    endEstimated: true,
    venueName: "Blue Gene's",
    address: "239 S 500 E, Salt Lake City, UT 84102",
    isFree: null,
    priceText: null,
    confidence: 0.75,
  },
  {
    key: "blue-genes-drag-karaoke-2026-11-11",
    url: "https://www.bluegenesslc.com/events",
    title: "Drag Karaoke with Sequoia",
    summary: "Wednesday drag karaoke night at Blue Gene's, hosted by Sequoia.",
    category: "nightlife",
    vibeTags: ["21-plus", "high-energy", "meet-people"],
    start: "2026-11-11T21:00",
    end: "2026-11-12T01:00",
    endEstimated: true,
    venueName: "Blue Gene's",
    address: "239 S 500 E, Salt Lake City, UT 84102",
    isFree: null,
    priceText: null,
    confidence: 0.75,
  },
  // Climbing
  {
    key: "front-ascl-kickoff-2026-11-07",
    url: "https://thefrontclimbingclub.com/slc/calendar",
    title: "ASCL Competition + Season Kickoff",
    summary: "First American Scholastic Climbing League bouldering comp of the season for grades 6–12. Spectators free.",
    category: "climbing",
    vibeTags: ["student", "high-energy", "family-friendly"],
    start: "2026-11-07T12:30",
    end: "2026-11-07T16:00",
    venueName: "The Front Climbing Club SLC",
    address: "1470 S 400 W, Salt Lake City, UT 84115",
    isFree: false,
    priceText: "$30 to compete; spectators free",
    confidence: 0.9,
  },
  {
    key: "front-rumsdays-2026-11-12",
    url: "https://thefrontclimbingclub.com/slc/calendar",
    title: "Rumsdays: Biocrusts & Rope-Access Archaeology",
    summary: "Science talk at The Front: Allison Izaksonas on Great Salt Lake biocrusts and Ian Farrell on archaeology using rope-access climbing.",
    category: "climbing",
    vibeTags: ["meet-people", "chill"],
    start: "2026-11-12T19:00",
    end: "2026-11-12T21:00",
    venueName: "The Front Climbing Club SLC",
    address: "1470 S 400 W, Salt Lake City, UT 84115",
    isFree: null,
    priceText: "Free for members; day pass for guests",
    confidence: 0.9,
  },
  {
    key: "momentum-lehi-bagels-boulders-2026-11-07",
    url: "https://momentumclimbing.com/utevents/",
    title: "Bagels & Boulders",
    summary: "Saturday-morning session at Momentum Lehi with free bagels and orange juice while supplies last.",
    category: "climbing",
    vibeTags: ["meet-people", "chill"],
    start: "2026-11-07T08:00",
    end: "2026-11-07T10:00",
    venueName: "Momentum Indoor Climbing Lehi",
    address: "401 S 850 E, Lehi, UT 84043",
    isFree: null,
    priceText: "Free bagels; gym entry required",
    confidence: 0.75,
  },
  {
    key: "slca-alpenbock-premiere-2026",
    url: "https://www.saltlakeclimbers.org/calendar",
    title: "Alpenbock Premiere at Lady of the Snows",
    summary: "Salt Lake Climbers Alliance screening of the Alpenbock film, with a Q&A after. Film at 6:30, Q&A at 7.",
    category: "climbing",
    vibeTags: ["outdoorsy", "meet-people"],
    start: "2026-11-19T18:00",
    end: "2026-11-19T20:00",
    venueName: "Our Lady of the Snows Center",
    address: "10185 E Hwy 210, Alta, UT 84092",
    isFree: false,
    priceText: "Tickets required",
    confidence: 0.9,
  },
  {
    key: "momentum-ice-season-opener-2026",
    url: "https://momentumclimbing.com/utevents/",
    title: "Ice Season Opener",
    summary: "Drytooling clinics, gear demos and a community social, then an evening keynote with Will Gadd benefiting Utah search and rescue.",
    category: "climbing",
    vibeTags: ["outdoorsy", "meet-people"],
    start: "2026-11-21T10:00",
    end: "2026-11-21T21:00",
    endEstimated: true,
    venueName: "Momentum Indoor Climbing Millcreek",
    address: "3173 E 3300 S, Salt Lake City, UT 84109",
    isFree: false,
    priceText: "Registration required",
    confidence: 0.7,
  },
  {
    key: "reel-rock-20-momentum-2026",
    url: "https://www.saltlakeclimbers.org/calendar",
    title: "Reel Rock 20",
    summary: "The annual climbing film tour at Momentum Millcreek. Doors 6:30, show at 7; proceeds go to the Salt Lake Climbers Alliance.",
    category: "climbing",
    vibeTags: ["outdoorsy", "meet-people"],
    start: "2026-12-06T18:30",
    end: "2026-12-06T21:30",
    venueName: "Momentum Indoor Climbing Millcreek",
    address: "3173 E 3300 S, Salt Lake City, UT 84109",
    isFree: false,
    priceText: "Tickets required",
    confidence: 0.9,
  },
];

/** Utah is on MST (UTC−7) for every date above. */
const toUtc = (local: string) => new Date(`${local}:00-07:00`).toISOString();

async function main() {
  const db = getDb();
  let source = db.select().from(schema.sources).where(eq(schema.sources.target, MANUAL_TARGET)).get();
  if (!source) {
    source = db
      .insert(schema.sources)
      .values({ type: "webpage", target: MANUAL_TARGET, label: "Added by hand", enabled: false })
      .returning()
      .get();
  }

  for (const m of EVENTS) {
    const point = (await geocode(m.address)) ?? (await geocode(`${m.venueName}, ${m.address}`));
    const raw = db
      .insert(schema.rawItems)
      .values({ sourceId: source.id, externalId: m.key, url: m.url, contentHash: m.key, engagement: {}, processedHash: m.key })
      .onConflictDoUpdate({ target: [schema.rawItems.sourceId, schema.rawItems.externalId], set: { url: m.url } })
      .returning()
      .get();
    const existing = db.select().from(schema.eventSources).where(eq(schema.eventSources.rawItemId, raw.id)).get();
    const values = {
      title: m.title,
      summary: m.summary,
      description: m.summary,
      category: m.category,
      vibeTags: m.vibeTags,
      startsAt: toUtc(m.start),
      endsAt: toUtc(m.end),
      endsAtEstimated: m.endEstimated ?? false,
      venueName: m.venueName,
      address: m.address,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      isFree: m.isFree,
      priceText: m.priceText,
      confidence: m.confidence,
      updatedAt: new Date().toISOString(),
    };
    if (existing) {
      db.update(schema.events).set(values).where(eq(schema.events.id, existing.eventId)).run();
    } else {
      const id = nanoid(12);
      db.insert(schema.events).values({ id, ...values }).run();
      db.insert(schema.eventSources).values({ eventId: id, rawItemId: raw.id }).run();
    }
    console.log(`${existing ? "updated" : "added  "} ${m.category.padEnd(10)} ${m.start}  ${m.title}${point ? "" : "  (no coordinates)"}`);
  }
}

main();
