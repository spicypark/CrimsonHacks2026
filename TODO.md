# PullUp TODO

Status as of commit `491141f`. Items marked (stretch) come from PLAN.md Tier 3.

## Data scraping

Pipeline, connectors, AI extraction, geocoding, merge, and worker.

- [ ] Verify embedding BLOB round-trip: `fromBlob` in `src/lib/ai/llm.ts` builds a Float32Array on `b.buffer` + `byteOffset` (possible alignment bug). Test by writing an event, reading it back, and checking cosine.
- [ ] Stale events: when a source stops listing an event, or a raw item's content changes, mark the event `cancelled`/re-link it instead of leaving it as-is.
- [ ] Re-link on changed raw items: a re-extracted item currently merges into the best match but keeps its old event link.
- [ ] Run the seed (`npm run seed`) and one full `npm run pipeline`; record which sources fail in `sources.last_error`.
- [ ] Verify webpage seed URLs (`scripts/seed-sources.ts`): visitsaltlake, slcpl, calendar.utah.edu. Replace or disable dead ones.
- [ ] Reddit: get OAuth credentials, or confirm the public Atom fallback (`fromAtom`) still works from Railway's IP.
- [ ] SeatGeek: confirm client ID approval; the connector throws if `SEATGEEK_CLIENT_ID` is missing.
- [ ] Ticketmaster: confirm key works and pages through 30 days (`ticketmaster.ts`).
- [ ] iCal/RSS: add a few venue calendar feeds (`ical` sources) and verify `feed.ts` parses them, including RRULE expansion.
- [ ] Geocoding: check Nominatim hit rate and how many events get dropped by `inRegion`.
- [ ] Migrations: web and worker both call `migrate()` on startup (`src/lib/db/client.ts`). Make sure concurrent startup on Railway can't race.
- [ ] Weather/AQI fetch: new `src/lib/geo/weather.ts` using Open-Meteo forecast and air-quality APIs (no key) for outdoor events in the next 7 days.
- [ ] Deploy the worker and web together on Railway with the `/data` volume and `DATABASE_PATH` set.
- [ ] (stretch) Cancellation and change detection.
- [ ] (stretch) Agent auto-discovers new sources.

## UI/dashboard

Next.js pages, components, and the admin view.

### Public site

- [ ] Event detail page `src/app/events/[id]/page.tsx`: hero image, time range, venue, MapLibre mini-map, AI summary (What / Who / Cost / What to bring), vibe tags, confidence, all sources with traction and "last checked", directions link.
- [ ] Map tab `src/app/map/page.tsx` (MapLibre + OpenFreeMap tiles) using the same filters as the list.
- [ ] Map time slider: now → end of day, 15-min steps, play button, pins fade in at `starts_at` and out at `ends_at`.
- [ ] Map pulsing pins for events happening now, and a density histogram above the slider.
- [ ] Map pin click → preview card → detail page.
- [ ] Estimated end labels: show "~ends 9 PM" when `ends_at_estimated` is true, on cards and detail.
- [ ] Natural-language search: `POST /api/search` (Gemini parses query → `Filters` with zod; keywords → embedding → cosine rank; Groq fallback).
- [ ] NL search box at the top of the list with removable filter chips showing what the AI understood.
- [ ] Maybe section UI for low-confidence events (`?maybe=1` already parsed server-side).
- [ ] Weather/AQI warning chip on outdoor event cards and detail, with a suggested indoor alternative.
- [ ] Check mobile filter bottom sheet in `src/components/events/filter-bar.tsx`.
- [ ] Empty, loading, and 404 states for list, detail, and map.
- [ ] Seen-on-N-sources badge and traction (▲ upvotes, 💬 comments, popularity) on cards.
- [ ] (stretch) Share button and share link with preview card (`shares` table already in schema).
- [ ] (stretch) Plan My Night.

### Admin dashboard

- [ ] Admin page `src/app/admin/[secret]/page.tsx` (missing). Use the existing SSE route `src/app/api/admin/stream/route.ts`.
- [ ] Live log rows colored by stage: 🔎 fetch, 🧠 extract, 📍 geocode, 🔗 merge.
- [ ] Counters: items fetched, events created, merged, dropped.
- [ ] Per-source status with `last_checked_at` and `last_error`.
- [ ] "Run now" button wired to `POST /api/admin/run`.
- [ ] Move the admin secret out of the query string for the run and stream requests (currently `?secret=`), so it doesn't land in logs or history.

### Polish (before the 12:15 freeze)

- [ ] Run the `ui-ux-pro-max` / `frontend-design` pass on the list, detail, and map.
- [ ] Demo data: confirm `scripts/seed-demo.ts` produces a list that looks good for the pitch.
- [ ] Rehearse the 2-minute demo script from PLAN.md §11.

## Technical features / data

Data-quality and algorithm work on what the pipeline produces.

- [ ] Dedup tuning: check the thresholds (cosine 0.85 / 0.75, ±3 h, 500 m) against real data. Log near-misses.
- [ ] Content-hash skip audit: confirm unchanged raw items are not re-extracted (`processed_hash`).
- [ ] Engagement history: store per-run engagement snapshots so traction growth can be shown and "popular" can use trends.
- [ ] Buzz score: decide what happens when only one source type has data (currently per-type percentile, max across types).
- [ ] Timezone audit: LLM local times → `toIso`. Check DST edges and events that cross midnight.
- [ ] Tag and category quality: sample ~50 events, measure accuracy, and tune prompts in `src/pipeline/extract.ts`.
- [ ] Confidence calibration: check that the 0.6 Maybe threshold separates real events from junk on real samples.
- [ ] Ends-at estimates: verify `DEFAULT_DURATION_MS` (`src/shared/event.ts`) against real events.
- [ ] Image fallback chain: source image → `og:image` → category gradient. Add `og:image` fetching to the webpage connector.
- [ ] Data-quality metrics: % of events with coords, price, image, and real end time. Show them in admin.
- [ ] AI usage tracking: count Gemini and Groq calls and failures per run.
- [ ] Embedding choice: confirm `gemini-embedding-001` at 768 dims is good enough for NL search ranking.

## Backend / database

Schema, queries, API, and operations.

- [ ] Indexes: check the filter query path (`events.ends_at`, `event_sources.raw_item_id`) with `EXPLAIN QUERY PLAN`, then add what's missing.
- [ ] Vector search cost: `cosine` runs in JS over candidate events. Measure it, and pre-filter by time window before ranking.
- [ ] Retention: prune old `raw_items`, orphaned events, and old `pipeline_log` rows.
- [ ] Shares: implement create and read for `shares` (share links, stretch).
- [ ] Event status: use `active` / `cancelled` / `changed` and wire it to change detection.
- [ ] API routes: add `GET /api/events/[id]`, `POST /api/search`, and validate admin request bodies with zod.
- [ ] Shared response types between API routes and UI components, so the shapes can't drift.
- [ ] Startup env validation: zod schema for `src/lib/env.ts`, failing fast on missing required keys.
- [ ] Worker shutdown: on SIGTERM, mark the running `pipeline_runs` row `failed` instead of leaving it `running`.
- [ ] WAL and `busy_timeout` under concurrent web and worker writes. Test with a load run.
- [ ] Backups: a script to export and import `pullup.db` from the Railway volume.
- [ ] Prod-import fallback (PLAN §10): a way to load rows scraped on a laptop (e.g. Reddit) into the prod DB.
- [ ] Tests for pure logic: `timeWindow`, `toIso`, dedup thresholds, and buzz percentiles.
