# PullUp — Utah's open-invite event finder

> Crimson Hacks 2026 · U of U · Theme: **State of Utah** · Build window: Fri Nov 6, ~5:00 PM → 1:00 AM

**One-liner:** An AI agent that combs Reddit, ticketing sites, and local calendars for public events anyone can attend along the Wasatch Front, merges duplicates, and serves them as a clean, filterable list (with a map and time slider) so you can just pull up.

*(Working name "PullUp" — rename freely.)*

---

## 1. Decisions (settled in grilling)

| # | Decision |
|---|----------|
| Scope | Wasatch Front (Ogden → Provo), map centered on SLC |
| "Public" | Free **and** paid events (anyone can buy a ticket). Free/Paid clearly labeled and filterable |
| Sources | Reddit, Ticketmaster, SeatGeek, iCal/RSS, schema.org web pages (+ LLM fallback). **No Instagram** |
| Language | TypeScript end-to-end |
| Framework | **Next.js 16** (App Router) · **React 19** · **Tailwind CSS 4** · shadcn/ui |
| Database | **SQLite** via `better-sqlite3` + **Drizzle ORM** |
| Vector search | Embeddings stored as BLOBs in SQLite, cosine similarity in plain TS (no extensions) |
| AI | **Gemini** free tier (extraction, tagging, summaries, NL query parsing, embeddings); **Groq** as fast fallback |
| Pipeline | Separate worker process writing to SQLite; admin page streams `pipeline_log` over **SSE** |
| Map | **MapLibre GL** + **OpenFreeMap** tiles (no key) |
| Geo / Utah data | **Nominatim** geocoding (cached, 1 req/s, Wasatch bbox) · **Open-Meteo** weather + air quality (no key) |
| Dedup | 3-stage: blocking → embedding similarity → LLM tie-break |
| Auth | None. Share links = unguessable IDs; admin = secret route |
| Hosting | **Railway**, one service (web + worker) with persistent volume for SQLite, custom domain |
| UI | **List-first.** Home = filterable/sortable event card list. Map is its own tab + embedded in each event |
| Demo data | Real scraped DB built tonight + live mini-run on stage from the admin view |

## 2. MVP tiers

**Tier 1 — Must ship (target ~9:30 PM)**
1. Pipeline core: Reddit, Ticketmaster/SeatGeek, iCal/RSS + schema.org connectors → normalized events → SQLite
2. AI extraction → structured fields + vibe tags + plain-English summary + confidence score
3. Geocoding (Nominatim + cache)
4. Duplicate merging + "seen on N sources" badge
5. **List view** (home): cards with image, name, date/time, location, Free/Paid, category + vibe tags, traction, source count
6. Filters (category, date, Free/Paid, vibe tags) + sort (soonest, most popular, nearest, newest)
7. Event detail page `/events/[id]`: summary, mini-map, sources with links, "last checked X min ago"
8. Natural-language search → filters + vector search
9. Deployed on the custom domain

**Tier 2 — Should ship (target ~11:30 PM)**
10. **Map tab with time slider** ⭐ (user priority — first thing built in Tier 2, see §6.3)
11. Live pipeline admin view + "Run now"
12. "Maybe" section for low-confidence events
13. Weather / AQI warnings on outdoor events

**Tier 3 — Stretch**
14. Plan My Night · 15. Share links with preview card · 16. Seasonal sections · 17. Cancellation/change detection · 18. Agent auto-discovers new sources

**Freeze at 12:15 AM** → polish, seed demo, rehearse pitch.

## 3. Architecture

```
                ┌───────────────────────── Railway service (1 container) ─────────────────────────┐
                │                                                                                  │
 Reddit ──┐     │  Worker (tsx src/pipeline/run.ts)              Next.js 16 app                    │
 TM/SG ───┤     │  ┌──────────┐ ┌─────────┐ ┌────────┐ ┌──────┐   ┌────────────────────────────┐   │
 iCal/RSS ┼────►│  │Connectors│→│ Extract │→│Geocode │→│Merge │   │ / list   /map   /events/id │   │
 Web/LD ──┘     │  └──────────┘ │ (Gemini)│ └────────┘ └──────┘   │ /admin (SSE)  /api/*       │   │
                │               └─────────┘        │              └─────────────▲──────────────┘   │
                │                                  ▼                            │                  │
                │                     SQLite on volume (/data/pullup.db) ◄──────┘                  │
                └──────────────────────────────────────────────────────────────────────────────────┘
```

- **One process boundary:** the worker owns writes for scraping; Next.js reads (and writes only RSVP/share rows). SQLite in WAL mode handles that concurrency fine.
- `npm start` runs both with `concurrently`. The admin "Run now" button inserts a `pipeline_runs` row with status `requested`; the worker polls for requested runs every 5 s.

## 4. Repo layout

```
src/
  app/                       # Next.js routes (UI + route handlers)
    page.tsx                 # list view (home)
    map/page.tsx             # map tab + time slider
    events/[id]/page.tsx     # detail
    admin/[secret]/page.tsx  # pipeline view
    api/
      events/route.ts        # GET filtered/sorted list
      search/route.ts        # POST natural-language search
      admin/stream/route.ts  # SSE pipeline log
      admin/run/route.ts     # POST trigger run
  components/                # EventCard, FilterBar, TimeSlider, EventMap, ...
  lib/
    db/ schema.ts client.ts  # Drizzle schema + singleton
    events/ query.ts         # the one place filtering/sorting lives (shared by list, map, search)
    ai/ gemini.ts groq.ts prompts.ts embed.ts
    geo/ geocode.ts weather.ts
  pipeline/
    run.ts                   # orchestrator: sources → connector → extract → geocode → merge
    connectors/              # ONE FILE PER SOURCE TYPE
      types.ts               # Connector interface
      reddit.ts ticketmaster.ts seatgeek.ts ical.ts webpage.ts
    extract.ts merge.ts log.ts
  shared/ event.ts           # RawItem, NormalizedEvent, Category, VibeTag types (zod)
scripts/ seed-sources.ts
drizzle/                     # migrations
```

### Connector seam (the key abstraction)

```ts
interface Connector {
  type: SourceType;                       // 'reddit' | 'ticketmaster' | 'seatgeek' | 'ical' | 'webpage'
  fetch(source: Source): Promise<RawItem[]>;   // raw posts/listings, no AI
}
```
Structured sources (Ticketmaster, SeatGeek, iCal, JSON-LD) map straight to `NormalizedEvent` and skip most AI cost; unstructured ones (Reddit, plain web pages) go through Gemini extraction. **New website = new `sources` row. New source *type* = new connector file.**

## 5. Data model (Drizzle / SQLite)

| Table | Key columns |
|-------|-------------|
| `sources` | id, type, url/query, label, enabled, last_checked_at |
| `raw_items` | id, source_id, external_id (unique per source), url, payload JSON, engagement JSON, fetched_at, content_hash |
| `events` | id, title, summary, description, category, vibe_tags JSON, starts_at, ends_at, **ends_at_estimated** bool, venue_name, address, lat, lng, is_free, price_text, image_url, confidence, buzz_score, status (`active`/`cancelled`/`changed`), embedding BLOB, updated_at |
| `event_sources` | event_id, raw_item_id, source_url, engagement JSON, last_checked_at (→ "seen on N sources") |
| `geocode_cache` | query PK, lat, lng, display_name |
| `pipeline_runs` | id, status, started_at, finished_at, stats JSON |
| `pipeline_log` | id, run_id, ts, stage, level, message, data JSON (feeds the admin SSE) |
| `shares` *(T3)* | id (nanoid), event_ids JSON, note, created_at |

**Categories** (fixed list for filters): Music · Outdoors · Climbing · Running/Fitness · Food & Drink · Arts & Culture · Community · Sports · Nightlife · Markets · Learning/Talks · Family.
**Vibe tags** (AI-assigned, multi): free · beginner-friendly · good-for-meeting-people · go-solo · family-friendly · 21+ · dog-friendly · outdoorsy · chill · high-energy · student.

## 6. Feature specs

### 6.1 List view (home)
- Default: next 7 days, soonest first, grouped by day headers ("Tonight", "Tomorrow", "Sat Nov 8").
- **Card:** image (source image → `og:image` → category gradient fallback) · title · date/time · venue + neighborhood · Free/price chip · category + top 3 vibe tags · traction (source icon + raw count, e.g. ▲ 214 · 💬 38) · "seen on N sources" · "happening now" badge · weather/AQI warning chip (T2).
- **Filters:** sticky top bar on desktop, bottom sheet on mobile. All filter state lives in **URL search params** → shared by list + map, shareable, back-button safe.
- **Sort:** soonest · most popular (buzz score) · nearest (asks for geolocation only when chosen) · newly added.
- NL search box at top; the parsed filters appear as removable chips so users see what the AI understood.

### 6.2 Event detail `/events/[id]`
Hero image, title, time range, venue, embedded MapLibre mini-map, AI summary ("What / Who it's for / Cost / What to bring"), vibe tags, confidence, all sources with traction and "last checked", directions link, (T3) share button.

### 6.3 Map tab + time slider ⭐
- Same filtered set as the list (shared URL params). Pin click → preview card → detail page.
- **Time slider** spans now → end of selected day (default: now → midnight; can extend through the filter's date range), 15-min steps, with a ▶ play button that animates it.
- At slider time *t*, an event is visible when `starts_at ≤ t < ends_at`. Pins **fade/scale in at start and fade out at end**, so dragging shows events appearing and disappearing.
- Events whose source gave no end time get `ends_at` estimated by category (e.g. run club 1.5 h, concert 3 h, market 4 h) and are flagged `ends_at_estimated` (shown as "~ends 9 PM").
- Pins for events in progress *now* pulse (CSS animation on a MapLibre HTML marker / circle layer). A small histogram above the slider shows event density over time.
- Implementation: client-side filter over the already-loaded event set (no refetch on drag) → GeoJSON source `setData` throttled with `requestAnimationFrame`.

### 6.4 Natural-language search
Query → Gemini (structured JSON output, zod-validated) → `{categories, vibeTags, isFree, dateRange, near: {place, radiusKm}, keywords}`. Places like "Sugar House" are geocoded. Filters narrow candidates; keywords → embedding → cosine rank. Fallback to Groq if Gemini errors or rate-limits.

### 6.5 AI extraction (pipeline)
One Gemini call per unstructured item with a strict JSON schema: `isPublicEvent`, `confidence (0–1)`, title, start/end (America/Denver), venue, address, price, category, vibeTags, summary. Items with `isPublicEvent=false` are dropped; `confidence < 0.6` → "Maybe" section (T2). Structured sources get a cheaper tags + summary call. Then embed `title + summary`.
Rate-limit handling: a small concurrency-limited queue (p-limit) with retry/backoff; skip items whose `content_hash` was already processed.

### 6.6 Duplicate merging
1. **Blocking:** start within ±3 h AND (distance ≤ 500 m OR fuzzy venue match).
2. **Similarity:** cosine(embeddings) ≥ 0.85 → merge.
3. **Tie-break:** 0.75–0.85 → Gemini "same event?" yes/no.
Merged event keeps all `event_sources`; each field takes the best value (structured source > LLM-extracted; longest description; real image > none).

### 6.7 Traction
Raw engagement stored per source (Reddit score + comments, SeatGeek popularity score, etc.). `buzz_score` = per-source percentile, max across sources → 0–100, used only for sorting. No data → nothing shown (never a fake 0).

### 6.8 Admin pipeline view (T2)
`/admin/[ADMIN_SECRET]`: live log stream via SSE (stage-colored rows: 🔎 fetch → 🧠 extract → 📍 geocode → 🔗 merge), counters (items fetched / events created / merged / dropped), per-source status, "Run now" button. This is the "behind the scenes" demo moment.

### 6.9 Weather / AQI (T2)
Open-Meteo forecast + air-quality for outdoor-tagged events within 7 days → warning chip if precip prob > 50%, wind > 35 km/h, or US AQI > 100; suggest an indoor event at a similar time.

## 7. Seed sources (Wasatch Front)
- **Reddit:** r/SaltLakeCity, r/Utah, r/slc, r/uofu, r/Provo (new posts + keyword search: "event", "meetup", "tonight", "this weekend", "free")
- **Ticketmaster Discovery API:** latlong=SLC, radius 60 mi
- **SeatGeek API:** lat/lon SLC, range 60 mi
- **iCal/RSS/web:** SLC Public Library, U of U events calendar, Visit Salt Lake, plus a few venue calendars (verify each feed URL at build time)

## 8. Environment / keys
`GEMINI_API_KEY` · `GROQ_API_KEY` · `TICKETMASTER_API_KEY` · `SEATGEEK_CLIENT_ID` · `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` · `ADMIN_SECRET` · `DATABASE_PATH=/data/pullup.db`
No key needed: OpenFreeMap, Nominatim (custom User-Agent required), Open-Meteo.
**Get every key in the first 30 minutes** — SeatGeek and Reddit approvals can lag.

## 9. Build timeline (tonight)

| Time | Work | Quality checkpoint |
|------|------|--------------------|
| 5:00–5:30 | Keys signup · scaffold Next 16 + Tailwind 4 + shadcn + Drizzle · schema + migrations · Railway project + volume + domain | — |
| 5:30–7:30 | Connector interface + Ticketmaster + iCal/JSON-LD + Reddit · extraction · geocoding · first real DB | `codebase-design` on the connector/pipeline seams |
| 7:30–9:30 | Merge · list view + cards + filters/sort (URL state) · detail page · NL search · deploy | **You run `/improve-codebase-architecture`** |
| 9:30–10:30 | **Map tab + time slider + pulsing pins** | — |
| 10:30–11:30 | Admin SSE view · Maybe section · weather/AQI | **You run `/thermo-nuclear-code-quality-review`** |
| 11:30–12:15 | Tier 3 picks (Plan My Night or share links) | — |
| 12:15–1:00 | **Freeze.** Full pipeline run on prod, polish with `ui-ux-pro-max` / `frontend-design` pass, rehearse | — |

Frontend work throughout uses the `ui-ux-pro-max` and `frontend-design` skills.

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Reddit API access/approval or datacenter IP blocking on Railway | Try OAuth script app first; fall back to public `.json` endpoints with a descriptive User-Agent; worst case run the Reddit connector from a laptop pointed at the prod DB import endpoint |
| SeatGeek client ID not approved in time | Ticketmaster covers ticketed events; SeatGeek becomes optional |
| Gemini free-tier rate limits during the bulk scrape | Concurrency limit + backoff, content-hash skip, Groq fallback, scrape early so the DB is full well before judging |
| Bad/hallucinated extraction | zod validation, confidence threshold, "Maybe" section, always link the original source |
| Nominatim 1 req/s | Cache table, dedupe queries, Ticketmaster/SeatGeek already include coords |
| Native `better-sqlite3` build on Windows/Railway | Use Node LTS (prebuilt binaries); verify in the first deploy at 5:30 |
| Live demo flakiness | DB pre-populated; on-stage run only touches 1–2 fast sources |

## 11. Demo script (2 min)
1. **Problem** (10 s): "Utah has tons of free, open events — they're scattered across Reddit threads, library calendars, and ticket sites."
2. **List** (30 s): open the app → tonight's events → filter "Free + Outdoors" → card shows "seen on 3 sources", ▲ 214.
3. **AI search** (20 s): "something chill and free near Sugar House tonight" → chips show what it understood.
4. **Map + time slider** (30 s): press ▶ — watch the valley light up and fade from 6 PM to midnight; pulsing pins are happening now.
5. **Behind the scenes** (25 s): admin view → Run now → watch it fetch, extract, geocode, merge live.
6. **Close** (5 s): "Just pull up."
