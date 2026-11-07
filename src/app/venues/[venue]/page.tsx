import { ArrowLeft, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EVENT_GRID, EventCard } from "@/components/events/event-card";
import { Skeleton } from "@/components/ui/skeleton";
import { filtersToParams, parseFilters } from "@/lib/events/filters";
import { dayDate, dayLabel } from "@/lib/events/format";
import { clusterOf, listDay, venueKey } from "@/lib/events/grouping";
import { queryEvents } from "@/lib/events/query";
import { semanticFilter } from "@/lib/search/semantic";

/**
 * Every event at one venue on one list day — where a condensed venue tile leads.
 * Carries the list's filters in the query string so it shows exactly what the tile counted.
 */
export default function VenuePage(props: PageProps<"/venues/[venue]">) {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-4 pb-24 sm:px-6">
      <Suspense fallback={<VenueSkeleton />}>
        <VenueDay params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function VenueDay({
  params,
  searchParams,
}: {
  params: PageProps<"/venues/[venue]">["params"];
  searchParams: PageProps<"/venues/[venue]">["searchParams"];
}) {
  const [{ venue }, sp] = await Promise.all([params, searchParams]);
  await connection();
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const filters = parseFilters(sp);
  const key = venueKey(decodeURIComponent(venue));
  const now = requestTime();

  // Same search path as the list (meaning-based match over the whole result set), so counts agree.
  const candidates = queryEvents({ ...filters, q: undefined });
  const matched = filters.q ? await semanticFilter(filters.q, candidates) : candidates;
  const events = matched.filter(
    (e) => clusterOf(e)?.key === key && (!day || listDay(e, now) === day),
  );
  if (!events.length) notFound();

  const cluster = clusterOf(events[0])!;
  const name = cluster.name;
  const branches = new Set(events.map((e) => e.venueName?.trim()).filter(Boolean)).size;
  const address = cluster.system
    ? `${branches} ${branches === 1 ? "branch" : "branches"}`
    : events.find((e) => e.address)?.address;
  const back = filtersToParams(filters).toString();

  return (
    <>
      <Link
        href={back ? `/?${back}` : "/"}
        className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors duration-200 hover:text-paprika"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Events
      </Link>

      <header className="mt-2 mb-8 border-b-2 border-ink pb-4">
        {day && (
          <p className="text-sm font-semibold tracking-wide text-paprika uppercase">
            {dayLabel(day, new Date(now))} · {dayDate(day)}
          </p>
        )}
        <h1 className="mt-1 text-4xl font-bold tracking-tight text-balance">{name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="font-semibold text-foreground">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
          {address && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 shrink-0 text-paprika" aria-hidden />
              {address}
            </span>
          )}
        </p>
      </header>

      <ol className={EVENT_GRID}>
        {events.map((e) => (
          <li key={e.id}>
            <EventCard event={e} now={now} />
          </li>
        ))}
      </ol>
    </>
  );
}

function VenueSkeleton() {
  return (
    <div aria-label="Loading events">
      <Skeleton className="mt-2 h-11 w-24" />
      <Skeleton className="mt-4 mb-8 h-24 w-2/3" />
      <div className={EVENT_GRID}>
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/** Server components render once per request (after searchParams), so one clock read per render is stable. */
const requestTime = () => Date.now();
