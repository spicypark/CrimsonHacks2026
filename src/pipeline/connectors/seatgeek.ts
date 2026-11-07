import { REGION, requireEnv } from "@/lib/env";
import type { Category, RawItem } from "@/shared/event";
import { getJson } from "./http";
import type { Connector } from "./types";

interface SgEvent {
  id: number;
  title: string;
  url: string;
  type: string;
  datetime_utc: string;
  datetime_tbd?: boolean;
  score?: number;
  description?: string;
  stats?: { lowest_price?: number | null; highest_price?: number | null };
  performers?: { image?: string | null }[];
  venue?: { name?: string; address?: string; extended_address?: string; location?: { lat: number; lon: number } };
}

const TYPE_TO_CATEGORY = (t: string): Category | null =>
  t.includes("concert") || t.includes("music") ? "music"
  : t.includes("theater") || t.includes("comedy") || t.includes("broadway") ? "arts-culture"
  : t.includes("family") ? "family"
  : t.match(/nba|nfl|nhl|mls|ncaa|sports|baseball|football|basketball|hockey|soccer|minor_league/) ? "sports"
  : null;

export const seatgeek: Connector = {
  type: "seatgeek",
  async fetch() {
    const clientId = requireEnv("SEATGEEK_CLIENT_ID");
    const params = new URLSearchParams({
      client_id: clientId,
      lat: String(REGION.center.lat),
      lon: String(REGION.center.lng),
      range: `${REGION.radiusMiles}mi`,
      per_page: "200",
      sort: "datetime_utc.asc",
      "datetime_utc.gte": new Date().toISOString().slice(0, 19),
      "datetime_utc.lte": new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 19),
    });
    const data = await getJson<{ events: SgEvent[] }>(`https://api.seatgeek.com/2/events?${params}`);
    return data.events.filter((e) => !e.datetime_tbd).map(toRawItem);
  },
};

function toRawItem(e: SgEvent): RawItem {
  const low = e.stats?.lowest_price;
  const high = e.stats?.highest_price;
  return {
    externalId: String(e.id),
    url: e.url,
    text: `${e.title}\n${e.description ?? ""}`,
    postedAt: null,
    engagement: e.score != null ? { popularity: e.score } : {},
    event: {
      title: e.title,
      description: e.description ?? "",
      startsAt: `${e.datetime_utc}Z`,
      endsAt: null,
      venueName: e.venue?.name ?? null,
      address: e.venue ? [e.venue.address, e.venue.extended_address].filter(Boolean).join(", ") : null,
      lat: e.venue?.location?.lat ?? null,
      lng: e.venue?.location?.lon ?? null,
      isFree: null, // SeatGeek lists resale prices; never assume free
      priceText: low ? `from $${low}${high && high !== low ? ` (up to $${high})` : ""}` : null,
      imageUrl: e.performers?.find((p) => p.image)?.image ?? null,
      category: TYPE_TO_CATEGORY(e.type),
    },
  };
}
