import { formatDistanceToNowStrict } from "date-fns";
import { ArrowBigUp, ArrowLeft, ArrowUpRight, CalendarDays, Clock, MapPin, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EventMap } from "@/components/events/event-map";
import { EventThumb } from "@/components/events/event-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CONFIDENCE_THRESHOLD,
  compact,
  dayDate,
  dayKey,
  dayLabel,
  formatTimeRange,
  isLive,
  priceLabel,
  SOURCE_LABELS,
  VIBE_LABELS,
} from "@/lib/events/format";
import { getEvent } from "@/lib/events/query";
import { CATEGORY_LABELS } from "@/shared/event";

export default function EventPage(props: PageProps<"/events/[id]">) {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-4 pb-24 sm:px-6">
      <Link
        href="/"
        className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-md px-2 text-sm font-semibold transition-colors duration-200 hover:text-paprika"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Events
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  const e = getEvent(id);
  if (!e) notFound();

  const now = requestTime();
  const live = isLive(e.startsAt, e.endsAt, now);
  const price = priceLabel(e.isFree, e.priceText);
  const key = dayKey(e.startsAt);
  const place = [e.venueName, e.address].filter((p): p is string => !!p);
  const hasCoords = e.lat != null && e.lng != null;
  const query = hasCoords ? `${e.lat},${e.lng}` : place.join(", ");
  const name = e.venueName ?? e.title;
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const appleUrl = hasCoords
    ? `https://maps.apple.com/?ll=${e.lat},${e.lng}&q=${encodeURIComponent(name)}`
    : `https://maps.apple.com/?q=${encodeURIComponent(query)}`;

  return (
    <article className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
      <div className="min-w-0">
        <div className="relative overflow-hidden rounded-lg">
          <EventThumb src={e.imageUrl} category={e.category} className="aspect-[16/9] w-full" />
          {live && (
            <span className="absolute top-4 left-4 flex items-center gap-1.5 rounded bg-floral px-2.5 py-1 text-sm font-bold text-carbon">
              <span className="live-dot size-2 rounded-full bg-paprika" aria-hidden />
              Happening now
            </span>
          )}
        </div>

        <ul className="mt-6 flex flex-wrap gap-1.5" aria-label="Tags">
          {e.status === "cancelled" && (
            <li className="rounded bg-destructive px-2 py-0.5 text-xs font-bold text-paper">Cancelled</li>
          )}
          {e.confidence < CONFIDENCE_THRESHOLD && (
            <li className="rounded border border-destructive px-2 py-0.5 text-xs font-semibold text-destructive">Unconfirmed</li>
          )}
          {e.category && <li className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">{CATEGORY_LABELS[e.category]}</li>}
          {e.vibeTags
            .filter((t) => t !== "free")
            .map((t) => (
              <li key={t} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {VIBE_LABELS[t]}
              </li>
            ))}
        </ul>

        <h1 className="mt-3 text-3xl leading-[1.1] font-bold tracking-tight sm:text-5xl">{e.title}</h1>

        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-border py-4 text-base">
          <span className="flex items-center gap-2 font-semibold">
            <CalendarDays className="size-5 text-paprika" aria-hidden />
            {dayLabel(key, new Date(now))}, {dayDate(key)}
          </span>
          <span className="flex items-center gap-2 font-semibold tabular-nums">
            <Clock className="size-5 text-paprika" aria-hidden />
            {formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated)}
          </span>
          {price && (
            <span
              className={
                e.isFree
                  ? "rounded bg-paprika px-2.5 py-1 text-sm font-bold tracking-wide text-carbon uppercase"
                  : "rounded bg-ink px-2.5 py-1 text-sm font-bold text-paper tabular-nums"
              }
            >
              {price}
            </span>
          )}
        </div>

        {e.summary && <p className="mt-6 max-w-2xl text-lg leading-relaxed">{e.summary}</p>}
        {e.description && e.description !== e.summary && (
          <p className="mt-4 max-w-2xl leading-relaxed whitespace-pre-line text-muted-foreground">{e.description}</p>
        )}

        {e.sources.length > 0 && (
          <section aria-labelledby="sources" className="mt-10">
            <h2 id="sources" className="mb-3 text-sm font-bold">
              Sources
            </h2>
            <ul className="divide-y divide-border border-y border-border">
              {e.sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex min-h-14 items-center gap-4 py-3 transition-colors duration-200 hover:text-paprika"
                  >
                    <span className="w-24 shrink-0 text-sm font-bold">{SOURCE_LABELS[s.type]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-hover:text-paprika">{s.label}</span>
                    <span className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums sm:flex">
                      {s.engagement.upvotes != null && (
                        <span className="flex items-center">
                          <ArrowBigUp className="size-4 text-paprika" aria-hidden />
                          {compact(s.engagement.upvotes)}
                          <span className="sr-only"> upvotes</span>
                        </span>
                      )}
                      {s.engagement.comments != null && (
                        <span className="flex items-center gap-1">
                          <MessageCircle className="size-3.5" aria-hidden />
                          {compact(s.engagement.comments)}
                          <span className="sr-only"> comments</span>
                        </span>
                      )}
                      <span>{formatDistanceToNowStrict(new Date(s.lastCheckedAt), { addSuffix: true })}</span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {place.length > 0 && (
        <aside aria-label="Location" className="lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-lg border border-border">
            {hasCoords && (
              <div className="aspect-square w-full border-b border-border sm:aspect-[4/3] lg:aspect-square">
                <EventMap lat={e.lat!} lng={e.lng!} label={name} />
              </div>
            )}
            <div className="p-4">
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-5 shrink-0 text-paprika" aria-hidden />
                <span>
                  <span className="block font-bold">{place[0]}</span>
                  {place[1] && <span className="block text-sm text-muted-foreground">{place[1]}</span>}
                </span>
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <MapButton href={googleUrl}>Google Maps</MapButton>
                <MapButton href={appleUrl}>Apple Maps</MapButton>
              </div>
            </div>
          </div>
        </aside>
      )}
    </article>
  );
}

function MapButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-paper transition-colors duration-200 hover:bg-paprika hover:text-carbon"
    >
      {children}
      <ArrowUpRight className="size-4" aria-hidden />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function DetailSkeleton() {
  return (
    <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12" aria-label="Loading event">
      <div className="space-y-6">
        <Skeleton className="aspect-[16/9] w-full rounded-lg" />
        <Skeleton className="h-12 w-3/4" />
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="aspect-square w-full rounded-lg" />
    </div>
  );
}

/** Server components render once per request, so one clock read per render is stable. */
const requestTime = () => Date.now();
