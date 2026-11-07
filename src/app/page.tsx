import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EVENT_GRID, EventCard } from "@/components/events/event-card";
import { FilterBar } from "@/components/events/filter-bar";
import { VenueCard } from "@/components/events/venue-card";
import { Skeleton } from "@/components/ui/skeleton";
import { type Filters, filtersToParams, parseFilters } from "@/lib/events/filters";
import { dayDate, dayLabel } from "@/lib/events/format";
import { clusterByVenue, groupByDay } from "@/lib/events/grouping";
import { queryEvents } from "@/lib/events/query";

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
  const events = queryEvents(filters);
  const now = requestTime();

  if (!events.length) return <EmptyState filtered={hasFilters(filters) || !!filters.maybe} />;

  if (filters.sort !== "soon") {
    return (
      <ol className={EVENT_GRID}>
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
          <details open className="group/day">
            <summary className="mb-5 flex cursor-pointer list-none items-center gap-3 border-b-2 border-ink pb-2 group-[:not([open])]/day:mb-0 [&::-webkit-details-marker]:hidden">
              <h2 id={`day-${key}`} className="flex items-baseline gap-3">
                <span className="text-3xl font-bold tracking-tight">{dayLabel(key, new Date(now))}</span>
                <span className="text-base text-muted-foreground">{dayDate(key)}</span>
              </h2>
              <span className="ml-auto text-sm text-muted-foreground">
                {group.length} {group.length === 1 ? "event" : "events"}
              </span>
              <ChevronDown
                aria-hidden
                className="size-6 shrink-0 text-muted-foreground transition-transform duration-200 group-[:not([open])]/day:-rotate-90"
              />
            </summary>
            <ol className={EVENT_GRID}>
              {clusterByVenue(group).map((item) =>
                item.kind === "event" ? (
                  <li key={item.event.id}>
                    <EventCard event={item.event} now={now} />
                  </li>
                ) : (
                  <li key={`venue-${item.venue}`}>
                    <VenueCard venue={item.venue} events={item.events} href={venueHref(item.venue, key, filters)} />
                  </li>
                ),
              )}
            </ol>
          </details>
        </section>
      ))}
    </div>
  );
}

/** Server components render once per request (after searchParams), so one clock read per render is stable. */
const requestTime = () => Date.now();

/** The venue day page, carrying the list's filters so it shows exactly what the tile counted. */
function venueHref(venue: string, day: string, filters: Filters): string {
  const params = filtersToParams(filters);
  params.set("day", day);
  return `/venues/${encodeURIComponent(venue)}?${params}`;
}

const hasFilters =(f: Filters) => !!(f.q || f.cat.length || f.vibe.length || f.free || f.when !== "week");

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
    <div className="flex flex-col gap-3 lg:flex-row" aria-hidden>
      <Skeleton className="h-11 w-full rounded-md lg:max-w-sm" />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-24 rounded-md" />
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-label="Loading events">
      <Skeleton className="mb-5 h-10 w-48" />
      <div className={EVENT_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
