import { ArrowBigUp, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import type { EventView } from "@/lib/events/query";
import {
  CONFIDENCE_THRESHOLD,
  compact,
  formatTimeRange,
  isLive,
  priceLabel,
  shortDate,
  SOURCE_LABELS,
  totalEngagement,
  VIBE_LABELS,
} from "@/lib/events/format";
import { CATEGORY_LABELS } from "@/shared/event";
import { EventThumb } from "./event-thumb";

/** One event as a tile: picture with price, then title, when, where and tags. The whole tile is one link. */
export function EventCard({ event: e, now }: { event: EventView; now: number }) {
  const live = isLive(e.startsAt, e.endsAt, now);
  const price = priceLabel(e.isFree, e.priceText);
  const traction = totalEngagement(e.sources.map((s) => s.engagement));
  const tags = e.vibeTags.filter((t) => t !== "free").slice(0, 2);
  const unverified = e.confidence < CONFIDENCE_THRESHOLD;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow] duration-200 hover:border-ink-soft hover:shadow-[0_6px_20px_-8px_rgb(37_36_34/0.35)] focus-within:border-ink-soft">
      <div className="relative">
        <EventThumb src={e.imageUrl} category={e.category} className="aspect-[3/2] w-full" />
        {price && (
          <span
            className={
              e.isFree
                ? "absolute top-3 right-3 rounded bg-carbon px-2 py-1 text-xs font-bold tracking-wide text-paprika uppercase"
                : "absolute top-3 right-3 rounded bg-floral px-2 py-1 text-xs font-bold text-carbon tabular-nums"
            }
          >
            {price}
          </span>
        )}
        {live && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded bg-floral px-2 py-1 text-xs font-bold text-carbon">
            <span className="live-dot size-2 rounded-full bg-paprika" aria-hidden />
            Now
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <h3 className="text-lg leading-snug font-bold tracking-tight">
          <Link
            href={`/events/${e.id}`}
            className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
          >
            {e.title}
          </Link>
        </h3>

        <div className="space-y-1.5 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CalendarDays className="size-4 shrink-0 text-paprika" aria-hidden />
            <span className="tabular-nums">
              {shortDate(e.startsAt)} · {formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated)}
            </span>
          </p>
          {(e.venueName || e.address) && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4 shrink-0 text-paprika" aria-hidden />
              <span className="truncate">
                {e.venueName ?? e.address}
                {e.distanceKm != null && ` · ${(e.distanceKm * 0.621).toFixed(1)} mi`}
              </span>
            </p>
          )}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-1">
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {unverified && (
              <li className="rounded border border-destructive px-2 py-0.5 text-xs font-semibold text-destructive">Unconfirmed</li>
            )}
            {e.category && (
              <li className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">{CATEGORY_LABELS[e.category]}</li>
            )}
            {tags.map((t) => (
              <li key={t} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {VIBE_LABELS[t]}
              </li>
            ))}
          </ul>
          {traction.upvotes != null ? (
            <span className="flex shrink-0 items-center text-xs font-semibold tabular-nums">
              <ArrowBigUp className="size-4 text-paprika" aria-hidden />
              {compact(traction.upvotes)}
              <span className="sr-only"> upvotes</span>
            </span>
          ) : (
            e.sources[0] && <span className="shrink-0 text-xs text-muted-foreground">{SOURCE_LABELS[e.sources[0].type]}</span>
          )}
        </div>
      </div>
    </article>
  );
}
