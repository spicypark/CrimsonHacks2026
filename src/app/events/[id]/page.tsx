import { ArrowBigUp, ArrowLeft, CalendarClock, ExternalLink, MapPin, MessageCircle, Navigation } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventThumb } from "@/components/events/event-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { CONFIDENCE_THRESHOLD, compact, dayDate, dayKey, dayLabel, formatTimeRange, isLive, priceLabel, SOURCE_LABELS, VIBE_LABELS } from "@/lib/events/format";
import { getEvent } from "@/lib/events/query";
import { CATEGORY_LABELS } from "@/shared/event";

export default function EventPage(props: PageProps<"/events/[id]">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24">
      <Link href="/" className="inline-flex h-10 items-center gap-1.5 rounded-lg pr-3 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All events
      </Link>
      <main id="main" className="mt-2">
        <Suspense fallback={<DetailSkeleton />}>
          <Detail params={props.params} />
        </Suspense>
      </main>
    </div>
  );
}

/** Server components render once per request, so one clock read per render is stable. */
const requestTime = () => Date.now();

const ago = (iso: string, now: number) => {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
};

async function Detail({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  const e = getEvent(id);
  if (!e) notFound();
  const now = requestTime();
  const live = isLive(e.startsAt, e.endsAt, now);
  const price = priceLabel(e.isFree, e.priceText);
  const sourceCount = new Set(e.sources.map((s) => s.label)).size;
  const key = dayKey(e.startsAt);
  const place = [e.venueName, e.address].filter(Boolean).join(", ");
  const directions =
    e.lat != null && e.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`
      : place
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
        : null;

  return (
    <article>
      <EventThumb src={e.imageUrl} category={e.category} className="aspect-[2/1] w-full rounded-2xl" />

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-alpenglow/15 px-2.5 py-1 text-sm font-semibold text-alpenglow">
            <span className="live-dot size-2 rounded-full bg-alpenglow" aria-hidden />
            Happening now
          </span>
        )}
        {e.confidence < CONFIDENCE_THRESHOLD && (
          <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-sm font-semibold text-destructive">Unverified: check the source</span>
        )}
        {e.status !== "active" && (
          <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-sm font-semibold text-destructive">
            {e.status === "cancelled" ? "Cancelled" : "Details changed"}
          </span>
        )}
      </div>

      <h1 className="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">{e.title}</h1>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="flex gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div>
            <dt className="sr-only">When</dt>
            <dd className="font-medium">
              {dayLabel(key, new Date(now))}, {dayDate(key)}
            </dd>
            <dd className="text-sm text-muted-foreground tabular-nums">
              {formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated)}
            </dd>
          </div>
        </div>
        {place && (
          <div className="flex gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <dt className="sr-only">Where</dt>
              <dd className="font-medium">{e.venueName ?? e.address}</dd>
              {e.venueName && e.address && <dd className="text-sm text-muted-foreground">{e.address}</dd>}
            </div>
          </div>
        )}
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Navigation className="size-4" aria-hidden />
            Get directions
          </a>
        )}
        {e.sources[0] && (
          <a
            href={e.sources[0].url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-input px-5 text-sm font-semibold hover:bg-accent"
          >
            <ExternalLink className="size-4" aria-hidden />
            {e.sources[0].type === "ticketmaster" || e.sources[0].type === "seatgeek" ? "Get tickets" : "See original post"}
          </a>
        )}
      </div>

      <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Details">
        {price && (
          <li className={e.isFree ? "rounded-full bg-primary px-2.5 py-1 text-sm font-semibold text-primary-foreground" : "rounded-full border border-input px-2.5 py-1 text-sm font-medium"}>
            {price}
          </li>
        )}
        {e.category && <li className="rounded-full bg-secondary px-2.5 py-1 text-sm font-medium">{CATEGORY_LABELS[e.category]}</li>}
        {e.vibeTags
          .filter((t) => t !== "free")
          .map((t) => (
            <li key={t} className="rounded-full px-2.5 py-1 text-sm text-muted-foreground ring-1 ring-border">
              {VIBE_LABELS[t]}
            </li>
          ))}
      </ul>

      {e.summary && (
        <section className="mt-8" aria-labelledby="summary">
          <h2 id="summary" className="text-lg font-semibold">
            In short
          </h2>
          <p className="mt-2 max-w-prose leading-relaxed text-foreground/90">{e.summary}</p>
        </section>
      )}

      {e.description && e.description !== e.summary && (
        <section className="mt-6" aria-labelledby="desc">
          <h2 id="desc" className="text-lg font-semibold">
            From the listing
          </h2>
          <p className="mt-2 max-w-prose leading-relaxed whitespace-pre-line text-muted-foreground">{e.description}</p>
        </section>
      )}

      <section className="mt-10" aria-labelledby="sources">
        <h2 id="sources" className="text-lg font-semibold">
          {sourceCount > 1 ? `Found on ${sourceCount} sources` : "Where we found it"}
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {e.sources.map((s) => (
            <li key={s.url} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium hover:underline">
                {s.type === "reddit" || s.type === "webpage" || s.type === "ical" ? s.label : SOURCE_LABELS[s.type]}
                <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
              </a>
              {s.engagement.upvotes != null && (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <ArrowBigUp className="size-4 text-alpenglow" aria-hidden />
                  {compact(s.engagement.upvotes)} upvotes
                </span>
              )}
              {s.engagement.comments != null && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <MessageCircle className="size-3.5" aria-hidden />
                  {compact(s.engagement.comments)} comments
                </span>
              )}
              <span className="ml-auto text-muted-foreground">Checked {ago(s.lastCheckedAt, now)}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading event">
      <Skeleton className="aspect-[2/1] w-full rounded-2xl" />
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  );
}
