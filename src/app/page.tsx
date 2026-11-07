import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard } from "@/components/events/event-card";
import { FilterBar } from "@/components/events/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { type Filters, parseFilters } from "@/lib/events/filters";
import { dayDate, dayKey, dayLabel } from "@/lib/events/format";
import { type EventView, queryEvents } from "@/lib/events/query";
import { topicFilter } from "@/lib/search/topic";

const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-5";

export default function Home(props: PageProps<"/">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
      <h1 className="sr-only">Events</h1>
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-4 py-3 sm:-mx-6 sm:px-6">
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterBar />
        </Suspense>
      </div>

      <main id="main" className="mt-8">
        <Suspense fallback={<ListSkeleton />}>
          <EventList searchParams={props.searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function EventList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const filters = parseFilters(await searchParams);
  await connection(); // live data: always render at request time, never at build
  // Search words are matched by meaning (Claude Haiku), not exact text; everything else filters in SQL.
  const candidates = queryEvents({ ...filters, q: undefined });
  const events = filters.q ? await topicFilter(filters.q, candidates) : candidates;
  const now = requestTime();

  if (!events.length) return <EmptyState filtered={hasFilters(filters) || !!filters.maybe} />;

  if (filters.sort !== "soon") {
    return (
      <ol className={GRID}>
        {events.map((e) => (
          <li key={e.id}>
            <EventCard event={e} now={now} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="space-y-12">
      {groupByDay(events, now).map(([key, group]) => (
        <section key={key} aria-labelledby={`day-${key}`}>
          <h2 id={`day-${key}`} className="mb-5 flex items-baseline gap-3 border-b-2 border-ink pb-2">
            <span className="text-3xl font-bold tracking-tight">{dayLabel(key, new Date(now))}</span>
            <span className="text-base text-muted-foreground">{dayDate(key)}</span>
            <span className="inline-flex h-7 items-center self-center rounded-md bg-secondary px-2.5 text-sm font-semibold tabular-nums text-ink">
              {group.length} {group.length === 1 ? "event" : "events"}
            </span>
          </h2>
          <ol className={GRID}>
            {group.map((e) => (
              <li key={e.id}>
                <EventCard event={e} now={now} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Server components render once per request (after searchParams), so one clock read per render is stable. */
const requestTime = () => Date.now();

/** Groups by Utah calendar day; events already underway are listed under today. */
function groupByDay(events: EventView[], now: number): [string, EventView[]][] {
  const nowIso = new Date(now).toISOString();
  const groups = new Map<string, EventView[]>();
  for (const e of events) {
    const key = dayKey(e.startsAt < nowIso ? nowIso : e.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()];
}

const hasFilters = (f: Filters) => !!(f.q || f.ask || f.near || f.cat.length || f.vibe.length || f.free || f.when !== "week");

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="py-20 text-center">
      <p className="text-lg font-bold">{filtered ? "Nothing matches." : "No events yet."}</p>
      {filtered && (
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors duration-200 hover:bg-ink-soft"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

function FilterBarSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1 rounded-md" />
        <Skeleton className="h-11 w-11 rounded-md sm:w-28" />
        <Skeleton className="h-11 w-11 rounded-md sm:w-28" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        <Skeleton className="h-10 w-80 shrink-0 rounded-md" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-24 shrink-0 rounded-md" />
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-label="Loading events">
      <Skeleton className="mb-5 h-10 w-48" />
      <div className={GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
