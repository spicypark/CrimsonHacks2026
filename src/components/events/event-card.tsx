import { ArrowBigUp, Layers, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";
import type { EventView } from "@/lib/events/query";
import {
  CONFIDENCE_THRESHOLD,
  compact,
  formatTime,
  formatTimeRange,
  isLive,
  priceLabel,
  SOURCE_LABELS,
  totalEngagement,
  VIBE_LABELS,
} from "@/lib/events/format";
import { CATEGORY_LABELS } from "@/shared/event";
import { EventThumb } from "./event-thumb";

/**
 * One event in the list: a time rail on the left (the list reads like a night's timeline),
 * then a card with title, place, price, tags and traction. The whole card is one link.
 */
export function EventCard({ event: e, now }: { event: EventView; now: number }) {
  const live = isLive(e.startsAt, e.endsAt, now);
  const price = priceLabel(e.isFree, e.priceText);
  const traction = totalEngagement(e.sources.map((s) => s.engagement));
  const sourceTypes = [...new Set(e.sources.map((s) => SOURCE_LABELS[s.type]))];
  const tags = e.vibeTags.filter((t) => t !== "free").slice(0, 2);
  const [time, meridiem] = formatTime(e.startsAt).split(" ");

  return (
    <article className="grid grid-cols-[3.75rem_1fr] gap-3 sm:grid-cols-[5.5rem_1fr] sm:gap-5">
      <div className="pt-3 text-right" aria-hidden>
        {live ? (
          <div className="flex flex-col items-end gap-1.5">
            <span className="flex items-center gap-1.5 font-heading text-lg font-semibold text-alpenglow sm:text-xl">
              <span className="live-dot size-2 rounded-full bg-alpenglow" />
              Now
            </span>
            <span className="whitespace-nowrap text-xs text-muted-foreground"><span className="hidden sm:inline">till </span>{formatTime(e.endsAt)}</span>
          </div>
        ) : (
          <div className="tabular-nums">
            <div className="font-heading leading-none">
              <span className="text-xl font-semibold sm:text-2xl">{time}</span>
              <span className="ml-0.5 text-xs font-medium text-muted-foreground">{meridiem}</span>
            </div>
            <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
              {/* Desktop: "till ~10 PM"; narrow rail on mobile: "–10 PM" / "~10 PM". */}
              <span className="hidden sm:inline">till {e.endsAtEstimated ? "~" : ""}</span>
              <span className="sm:hidden">{e.endsAtEstimated ? "~" : "–"}</span>
              {formatTime(e.endsAt)}
            </div>
          </div>
        )}
      </div>

      <div className="group relative grid grid-cols-[1fr_auto] gap-4 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/60 focus-within:border-primary/60 sm:p-4">
        <div className="min-w-0 space-y-2">
          <h3 className="font-heading text-base leading-snug font-semibold sm:text-lg">
            <Link
              href={`/events/${e.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {e.title}
            </Link>
          </h3>

          <p className="text-sm text-muted-foreground">
            <span className="sr-only">{live ? "Happening now, " : ""}{formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated)}. </span>
            {(e.venueName || e.address) && (
              <span className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span className="line-clamp-1">
                  {e.venueName ?? e.address}
                  {e.distanceKm != null && <span className="text-muted-foreground/80"> ({(e.distanceKm * 0.621).toFixed(1)} mi)</span>}
                </span>
              </span>
            )}
          </p>

          <ul className="flex flex-wrap gap-1.5" aria-label="Details">
            {e.confidence < CONFIDENCE_THRESHOLD && (
              <li className="whitespace-nowrap rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                Unverified
              </li>
            )}
            {price && (
              <li
                className={
                  e.isFree
                    ? "whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground"
                    : "whitespace-nowrap rounded-full border border-input px-2 py-0.5 text-xs font-medium tabular-nums"
                }
              >
                {price}
              </li>
            )}
            {e.category && (
              <li className="whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{CATEGORY_LABELS[e.category]}</li>
            )}
            {tags.map((t) => (
              <li key={t} className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                {VIBE_LABELS[t]}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {traction.upvotes != null && (
              <span className="flex items-center gap-0.5 font-medium text-foreground/90 tabular-nums">
                <ArrowBigUp className="size-4 text-alpenglow" aria-hidden />
                {compact(traction.upvotes)}
                <span className="sr-only"> upvotes</span>
              </span>
            )}
            {traction.comments != null && (
              <span className="flex items-center gap-1 tabular-nums">
                <MessageCircle className="size-3.5" aria-hidden />
                {compact(traction.comments)}
                <span className="sr-only"> comments</span>
              </span>
            )}
            {e.sources.length > 1 ? (
              <span className="flex items-center gap-1 font-medium text-sage">
                <Layers className="size-3.5" aria-hidden />
                On {e.sources.length} sources
              </span>
            ) : (
              sourceTypes[0] && <span>via {sourceTypes[0]}</span>
            )}
          </div>
        </div>

        <EventThumb
          src={e.imageUrl}
          category={e.category}
          className="size-20 shrink-0 rounded-lg sm:h-28 sm:w-40"
        />
      </div>
    </article>
  );
}
