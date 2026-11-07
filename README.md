hello khangai

# PullUp

Open-invite events along Utah's Wasatch Front. An AI pipeline gathers events from Reddit, Ticketmaster, SeatGeek, iCal/RSS feeds and event web pages, merges duplicates, and serves them as a filterable list with a map and time slider.

Built at Crimson Hacks 2026 (University of Utah). See [PLAN.md](PLAN.md) for the design and [SETUP.md](SETUP.md) for keys and hosting.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in keys (SETUP.md)
npm run seed                 # add the starting sources
npm run pipeline             # one full scrape → data/pullup.db
npm run dev                  # web app + background worker on http://localhost:3000
```

## Layout

- `src/pipeline/connectors/` — one adapter per source type (`Connector` interface in `types.ts`)
- `src/pipeline/` — orchestrator (`run.ts`), AI extraction, dedup merge, worker
- `src/lib/events/` — the single filter/sort/query module used by list, map, search and API
- `src/lib/ai/llm.ts` — typed JSON generation (Gemini, Groq fallback) + embeddings
- `src/lib/db/` — Drizzle schema and SQLite client (migrations in `drizzle/`)
