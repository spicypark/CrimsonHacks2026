import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventCard } from "@/components/events/event-card";
import { FilterBar } from "@/components/events/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { type Filters, parseFilters } from "@/lib/events/filters";
import { dayDate, dayKey, dayLabel } from "@/lib/events/format";
import { type EventView, queryEvents } from "@/lib/events/query";

const SORT_HEADINGS: Record<Exclude<Filters["sort"], "soon">, string> = {
  popular: "Most popular",
  near: "Closest to you",
  new: "Newly added",
};

export default function Home(props: PageProps<"/">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24">
      <header className="pt-8 pb-6 sm:pt-12">
        <Link href="/" className="inline-block font-heading text-4xl font-extrabold tracking-tight sm:text-5xl">
          PullUp
        </Link>
        <p className="mt-2 max-w-md text-muted-foreground">
          Public events from Ogden to Provo that anyone can walk into. Pick one and show up.
        </p>
      </header>

      <div className="z-20 -mx-4 bg-background/90 px-4 py-3 backdrop-blur sm:sticky sm:top-0">
        <Suspense fallback={<FilterBarSkeleton />}>
          <FilterBar />
        </Suspense>
      </div>

      <main id="main" className="mt-4">
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
  const events = queryEvents(filters);
  const now = requestTime();

  if (!events.length) return <EmptyState filtered={hasFilters(filters)} maybe={!!filters.maybe} />;

  const summary = (
    <p className="mb-6 text-sm text-muted-foreground" aria-live="polite">
      {events.length} {filters.maybe ? "unverified " : ""}
      {events.length === 1 ? "event" : "events"}
      {filters.q ? ` matching “${filters.q}”` : ""}
    </p>
  );

  if (filters.sort !== "soon") {
    return (
      <section aria-labelledby="flat-heading">
        <h2 id="flat-heading" className="mb-1 text-2xl font-bold tracking-tight">
          {SORT_HEADINGS[filters.sort]}
        </h2>
        {summary}
        <ol className="space-y-3">
          {events.map((e) => (
            <li key={e.id}>
              <EventCard event={e} now={now} />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <>
      {summary}
      <div className="space-y-10">
        {groupByDay(events, now).map(([key, group]) => (
          <section key={key} aria-labelledby={`day-${key}`}>
            <h2 id={`day-${key}`} className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
              <span className="text-2xl font-bold tracking-tight sm:text-3xl">{dayLabel(key, new Date(now))}</span>
              <span className="text-sm font-medium text-muted-foreground">{dayDate(key)}</span>
              <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                {group.length} {group.length === 1 ? "event" : "events"}
              </span>
            </h2>
            <ol className="space-y-3">
              {group.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} now={now} />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
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

const hasFilters = (f: Filters) => !!(f.q || f.cat.length || f.vibe.length || f.free || f.when !== "week");

function EmptyState({ filtered, maybe }: { filtered: boolean; maybe: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <h2 className="text-xl font-semibold">
        {maybe ? "No unverified events right now" : filtered ? "Nothing matches these filters" : "No events found yet"}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {filtered || maybe
          ? "Try a wider date range, or remove a filter or two."
          : "The finder hasn’t collected any events yet. Check back after the next update."}
      </p>
      {(filtered || maybe) && (
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
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
      <Skeleton className="h-11 w-full rounded-xl" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading events">
      <Skeleton className="mb-6 h-4 w-24" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="grid grid-cols-[3.75rem_1fr] gap-3 sm:grid-cols-[5.5rem_1fr] sm:gap-5">
          <Skeleton className="mt-3 ml-auto h-6 w-12" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      ))}
    </div>
  );
}
