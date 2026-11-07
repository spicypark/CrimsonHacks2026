import { ArrowRight, CalendarDays, LibraryBig, MapPin } from "lucide-react";
import Link from "next/link";
import { formatTime, formatTimeRange, shortDate } from "@/lib/events/format";
import type { EventView } from "@/lib/events/query";

const PREVIEW = 3;

/**
 * Several events at one venue (or across one library system's branches) on one day, condensed into a
 * single tile that links to the venue page.
 * Drawn as a stack of cards so it reads as "many" at a glance; same footprint as an EventCard.
 */
export function VenueCard({
  venue,
  system,
  events,
  href,
}: {
  venue: string;
  system: boolean;
  events: EventView[];
  href: string;
}) {
  const Icon = system ? LibraryBig : MapPin;
  const branches = new Set(events.map((e) => e.venueName?.trim()).filter(Boolean)).size;
  const first = events[0];
  const lastEnd = events.reduce((max, e) => (e.endsAt > max ? e.endsAt : max), first.endsAt);
  const free = events.filter((e) => e.isFree).length;
  const rest = events.length - PREVIEW;

  return (
    <article className="group relative mr-2 mb-2 flex h-[calc(100%-0.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[4px_4px_0_-1px_var(--card),4px_4px_0_0_var(--border),8px_8px_0_-1px_var(--card),8px_8px_0_0_var(--border)] transition-colors duration-200 hover:border-ink-soft focus-within:border-ink-soft">
      <div className="relative">
        {/* The count is the picture: a condensed tile is about how many, not any one event's image. */}
        <div className="grid aspect-[3/2] w-full place-content-center bg-dust text-center text-carbon" aria-hidden>
          <span className="text-7xl leading-none font-bold tracking-tight tabular-nums sm:text-8xl">{events.length}</span>
          <span className="mt-1 text-lg font-semibold tracking-wide uppercase">events</span>
        </div>
        {free > 0 && (
          <span className="absolute top-3 left-3 rounded bg-carbon px-2 py-1 text-xs font-bold tracking-wide text-paprika uppercase">
            {free === events.length ? "All free" : `${free} free`}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-lg leading-snug font-bold tracking-tight">
          <Link
            href={href}
            className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            <Icon className="mr-1.5 -mt-0.5 inline size-4 text-paprika" aria-hidden />
            {venue}
          </Link>
        </h3>

        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CalendarDays className="size-4 shrink-0 text-paprika" aria-hidden />
            <span className="tabular-nums">
              {shortDate(first.startsAt)} · {formatTimeRange(first.startsAt, lastEnd, false)}
            </span>
          </p>
          {system && branches > 1 && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-paprika" aria-hidden />
              Across {branches} branches
            </p>
          )}
        </div>

        <ul className="space-y-1 text-sm" aria-label={`Events at ${venue}`}>
          {events.slice(0, PREVIEW).map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-16 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{formatTime(e.startsAt)}</span>
              <span className="truncate">{e.title}</span>
            </li>
          ))}
        </ul>

        <p className="mt-auto flex items-center gap-1.5 pt-1 text-sm font-semibold group-hover:text-paprika">
          {rest > 0 ? `+${rest} more · See all` : "See all"}
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </p>
      </div>
    </article>
  );
}
