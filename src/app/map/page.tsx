import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { LiveMap, type MapEvent } from "@/components/map/live-map";
import { parseFilters } from "@/lib/events/filters";
import { queryEvents } from "@/lib/events/query";

export const metadata: Metadata = {
  title: "Live map — PullUp",
  description: "Scrub through the next week and watch events appear across the Salt Lake Valley.",
};

/** Full-height map under the header. Data: every placed event in the next 7 days; filtering happens client-side. */
export default function MapPage() {
  return (
    <main id="main" className="flex h-[calc(100dvh-3.5rem)] min-h-[32rem] flex-col">
      <h1 className="sr-only">Live map</h1>
      <Suspense fallback={<div className="flex-1 animate-pulse bg-muted" aria-label="Loading map" />}>
        <MapData />
      </Suspense>
    </main>
  );
}

async function MapData() {
  await connection(); // live data: render at request time
  const now = requestTime();
  const events: MapEvent[] = queryEvents(parseFilters({ when: "week" }), { now: new Date(now) })
    .filter((e) => e.lat != null && e.lng != null)
    .map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      vibeTags: e.vibeTags,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      venueName: e.venueName,
      lat: e.lat!,
      lng: e.lng!,
      isFree: e.isFree,
      buzzScore: e.buzzScore,
      search: `${e.title} ${e.summary} ${e.venueName ?? ""} ${e.address ?? ""}`.toLowerCase(),
    }));
  return <LiveMap events={events} now={now} />;
}

const requestTime = () => Date.now();
