import { REGION, requireEnv } from "@/lib/env";
import type { Category, RawItem } from "@/shared/event";
import { utahLocalToIso } from "@/shared/time";
import { getJson, isoNoMs } from "./http";
import type { Connector } from "./types";

interface TmEvent {
  id: string;
  name: string;
  url: string;
  info?: string;
  pleaseNote?: string;
  images?: { url: string; width: number; ratio?: string }[];
  dates: { start: { dateTime?: string; localDate?: string }; end?: { dateTime?: string } };
  classifications?: { segment?: { name: string }; genre?: { name: string } }[];
  priceRanges?: { min?: number; max?: number; currency?: string }[];
  _embedded?: {
    venues?: {
      name?: string;
      address?: { line1?: string };
      city?: { name?: string };
      state?: { stateCode?: string };
      location?: { latitude: string; longitude: string };
    }[];
  };
}

const SEGMENT_TO_CATEGORY: Record<string, Category> = {
  Music: "music",
  Sports: "sports",
  "Arts & Theatre": "arts-culture",
  Film: "arts-culture",
  Family: "family",
};

const DAYS_AHEAD = 30;

export const ticketmaster: Connector = {
  type: "ticketmaster",
  async fetch() {
    const key = requireEnv("TICKETMASTER_API_KEY");
    const now = new Date();
    const params = new URLSearchParams({
      apikey: key,
      latlong: `${REGION.center.lat},${REGION.center.lng}`,
      radius: String(REGION.radiusMiles),
      unit: "miles",
      size: "199",
      sort: "date,asc",
      startDateTime: isoNoMs(now),
      endDateTime: isoNoMs(new Date(now.getTime() + DAYS_AHEAD * 864e5)),
    });

    const items: RawItem[] = [];
    // size*page must stay < 1000; 3 pages is plenty for a 30-day window.
    for (let page = 0; page < 3; page++) {
      params.set("page", String(page));
      const data = await getJson<{ _embedded?: { events: TmEvent[] }; page: { totalPages: number } }>(
        `https://app.ticketmaster.com/discovery/v2/events.json?${params}`,
      );
      for (const e of data._embedded?.events ?? []) items.push(toRawItem(e));
      if (page + 1 >= data.page.totalPages) break;
      await new Promise((r) => setTimeout(r, 250)); // 5 req/s limit
    }
    return items;
  },
};

function toRawItem(e: TmEvent): RawItem {
  const venue = e._embedded?.venues?.[0];
  const price = e.priceRanges?.[0];
  // 16:9 image closest to 640px wide: sharp on cards and the detail hero without 2048px downloads.
  const image = [...(e.images ?? [])]
    .filter((i) => i.ratio === "16_9")
    .sort((a, b) => Math.abs(a.width - 640) - Math.abs(b.width - 640))[0] ?? e.images?.[0];
  const segment = e.classifications?.[0]?.segment?.name ?? "";
  // Date-only listings (time TBA) default to 7 PM Utah time.
  const startsAt = e.dates.start.dateTime ?? (e.dates.start.localDate ? utahLocalToIso(e.dates.start.localDate) : null);
  const description = [e.info, e.pleaseNote].filter(Boolean).join("\n\n");

  return {
    externalId: e.id,
    url: e.url,
    text: `${e.name}\n${description}`,
    postedAt: null,
    engagement: {},
    event: startsAt
      ? {
          title: e.name,
          description,
          startsAt,
          endsAt: e.dates.end?.dateTime ?? null,
          venueName: venue?.name ?? null,
          address: venue
            ? [venue.address?.line1, venue.city?.name, venue.state?.stateCode].filter(Boolean).join(", ")
            : null,
          lat: venue?.location ? Number(venue.location.latitude) : null,
          lng: venue?.location ? Number(venue.location.longitude) : null,
          isFree: price ? price.min === 0 && !price.max : null,
          priceText: price?.min != null ? `$${price.min}${price.max && price.max !== price.min ? `–$${price.max}` : ""}` : null,
          imageUrl: image?.url ?? null,
          category: SEGMENT_TO_CATEGORY[segment] ?? null,
        }
      : null,
  };
}
