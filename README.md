# PullUp

Open-invite events along Utah's Wasatch Front, in one place.

Utah's free and public events are spread across Reddit threads, library calendars, university feeds and ticketing sites. PullUp collects events from all of those, uses AI to read the details, places each event on a map, merges duplicates, and shows everything as one filterable list with a live map.

## Features

- **Event list** (`/`): upcoming events grouped by day, with filters for time, category, vibe and free only. You can sort by soonest, most popular, nearest or newest. Filters are stored in the URL, so a link shares your exact view.
- **AI search**: type something like "chill free music near Sugar House tonight" and it becomes filters.
- **Live map** (`/map`): pins appear and disappear as you drag a time slider across the next 7 days. Pins pulse for events happening right now.
- **Event pages** (`/events/[id]`): a summary, a map, directions, and every source the event was found on.
- **Plan my night** (`/plan`): describe your night in plain English and get an ordered list of real events to go to.
- **Desk display**: an ESP32 screen that shows the best upcoming event for your interests. See [`device/README.md`](device/README.md).

## How it works

The app runs as two processes that share one SQLite file. A worker scrapes and writes events, and the Next.js app reads them and serves the site.

```
  Reddit  Ticketmaster  SeatGeek  iCal  Library calendars  Web pages
     |         |            |       |           |              |
     +---------+------------+---+---+-----------+--------------+
                                |
                                v
   +----------------------- Worker -------------------------+
   |  fetch  ->  AI extract  ->  geocode  ->  merge dupes   |
   +--------------------------------------------------------+
                                |
                                v
                      [ SQLite: pullup.db ]
                                |
                                v
   +--------------------- Next.js app ----------------------+
   |   list  |  map  |  event pages  |  plan  |  /api/*     |
   +--------------------------------------------------------+
```

The worker runs the whole pipeline every 3 hours, and also when the admin API asks for a run.

### The pipeline

1. **Fetch.** Each source type has a connector in `src/pipeline/connectors/`. Structured sources (Ticketmaster, SeatGeek, iCal, library calendars, pages with event data built in) return ready-made events. Unstructured sources (Reddit posts, plain web pages) return text.
2. **Skip unchanged items.** Each item is hashed, and only new or changed items go through AI, so re-runs are cheap.
3. **Extract.** Claude Haiku reads unstructured text and pulls out the events. For structured events it adds a category, vibe tags and a short summary. Private, past or non-Utah posts are dropped.
4. **Geocode.** Venues are turned into coordinates with OpenStreetMap Nominatim, and the results are cached. Anything outside the Wasatch Front is dropped.
5. **Merge duplicates.** The same event often shows up on several sites:

```
  new event
     |
     v
  another event starting within 3 h, at the same place or venue? --no--> save as new
     |
    yes
     |
     v
  how similar are the titles?
     |-- very similar ------------> merge
     |-- somewhat similar --> ask Claude "same event?" --yes--> merge
     |                                                  --no---> save as new
     |-- not similar -------------> save as new
```

6. **Score popularity.** Reddit upvotes and comments and SeatGeek popularity become a 0 to 100 "buzz" score, which is used for the "most popular" sort.

### Search

```
  "free jazz near Sugar House tonight"
                |
                v
        Claude -> filters:  free, tonight, topic "jazz", place "Sugar House"
                |
                +--> "jazz" expanded to related words (bebop, big band, ...)
                +--> "Sugar House" geocoded -> events within 5 km
                |
                v
        matching events, sorted
```

If Claude isn't available, the search falls back to plain keywords, so it still works.

## Tech stack

- **Next.js 16**, **React 19**, TypeScript
- **Tailwind CSS 4** + **shadcn/ui**
- **SQLite** (`better-sqlite3`) + **Drizzle ORM**
- **Claude Haiku 5.5** for all AI features
- **MapLibre GL** + **OpenFreeMap** tiles
- **Nominatim** for geocoding
- **cheerio** and **node-ical** for scraping
- Hosted on **Railway**, with a volume for the database

## Project layout

```
src/
  app/            pages and /api routes
  components/     UI (event cards, map, planner, shadcn/ui)
  lib/
    ai/           Claude client
    db/           schema and SQLite client
    events/       filtering and sorting (shared by list, map, search, API)
    search/       natural-language search
    plan/         plan my night
  pipeline/
    connectors/   one file per source type
    run.ts        runs the pipeline
    merge.ts      duplicate merging
    worker.ts     background worker
scripts/          seed sources, demo data, snapshots
device/           ESP32 desk display
```

## Running locally

Requires Node.js 22.9 or newer.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in your keys in `.env.local`, then run these in order:

```bash
npm run seed
```

```bash
npm run pipeline
```

```bash
npm run dev
```

`npm run seed` adds the starting sources, `npm run pipeline` does one full scrape, and `npm run dev` starts the site and the worker at http://localhost:3000.

No keys yet? Run `npm run seed:demo` to load sample events (remove them with `npm run seed:demo -- --clear`).

### Environment variables

| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Powers extraction, search and planning. Without it, search uses plain keywords |
| `TICKETMASTER_API_KEY` | Optional |
| `SEATGEEK_CLIENT_ID` | Optional |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME` | Optional. Without them Reddit is read from public feeds, which have no vote counts |
| `ADMIN_SECRET` | Protects the `/api/admin/*` routes |
| `APP_URL` | The site's public URL |
| `DATABASE_PATH` | Defaults to `./data/pullup.db` |

## API

| Endpoint | |
|---|---|
| `GET /api/events` | Filtered events. Takes the same params as the page URL |
| `POST /api/search` `{ q }` | Turns a search into filters |
| `POST /api/plan` `{ text }` | Builds a night plan |
| `GET /api/device?for=...` | Picks for the desk display |
| `POST /api/admin/run?secret=...` | Starts a pipeline run |
| `GET /api/admin/stream?secret=...` | Live pipeline log |
| `POST /api/admin/import` | Uploads a database snapshot |

## Deploying

The site and the worker run together as one Railway service via `npm start`. Mount a volume at `/data` and set `DATABASE_PATH=/data/pullup.db`.

To copy your local events to the live site:

```bash
npm run snapshot
```

```bash
curl -X POST -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/octet-stream" --data-binary @data/pullup-snapshot.db https://<your-domain>/api/admin/import
```

## Adding a source

- **A new site of a type that's already supported:** add it to `scripts/seed-sources.ts`.
- **A new kind of source:** add a connector file in `src/pipeline/connectors/` and register it in `connectors/index.ts`.
