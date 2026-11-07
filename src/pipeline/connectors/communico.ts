import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import type { RawItem } from "@/shared/event";
import { TIME_ZONE, toIso } from "@/shared/time";
import { getJson } from "./http";
import type { Connector } from "./types";

/** Subset of a Communico ("libnet.info") calendar record. */
interface CommunicoEvent {
  id: string;
  title: string;
  sub_title?: string;
  description?: string;
  long_description?: string;
  event_start: string; // "2026-11-06 18:00:00", Utah local
  event_end: string;
  time_string?: string; // "All day" | "6:00pm - 7:00pm"
  library?: string; // branch name, e.g. "Sandy"
  venue_name?: string;
  url: string;
  private_event?: string;
  registration_cost?: string;
  event_image?: string | null;
  image?: string | null;
  tags?: string;
  ages?: string;
  changed?: string;
  changed_reason?: string;
}

const DAYS = 14;

/**
 * Library calendars hosted on Communico (used by Salt Lake City and Salt Lake County libraries).
 * source.target = calendar base URL (e.g. https://slcls.libnet.info); source.label names the library system.
 */
export const communico: Connector = {
  type: "communico",
  async fetch(source) {
    const base = source.target.replace(/\/$/, "");
    const req = {
      private: false,
      date: format(new TZDate(Date.now(), TIME_ZONE), "yyyy-MM-dd"),
      days: DAYS,
      locations: [],
      ages: [],
      types: [],
    };
    const rows = await getJson<CommunicoEvent[]>(`${base}/eeventcaldata?event_type=0&req=${encodeURIComponent(JSON.stringify(req))}`);
    const system = source.label.replace(/\s*\(.*\)$/, "");

    const city = /city/i.test(system) ? "Salt Lake City" : "Utah";

    return rows
      .filter((e) => e.private_event !== "1" && e.title && !/virtual|online/i.test(e.library ?? ""))
      .map((e): RawItem => {
        const { venueName, address } = place(e.library, system, city);
        const cost = Number(e.registration_cost ?? 0);
        const description = [e.sub_title, stripHtml(e.description), stripHtml(e.long_description)]
          .filter(Boolean)
          .join("\n");
        const image = e.event_image || e.image || null;
        return {
          externalId: e.id,
          url: e.url,
          text: `${e.title}\n${description}\nAges: ${e.ages ?? ""}\nTags: ${e.tags ?? ""}`.slice(0, 3000),
          postedAt: null,
          engagement: {},
          event: {
            title: e.sub_title && !e.title.includes(e.sub_title) ? `${e.title}: ${e.sub_title}` : e.title,
            description: [description, e.ages ? `Ages: ${e.ages}` : ""].filter(Boolean).join("\n\n"),
            startsAt: toIso(e.event_start.replace(" ", "T"))!,
            endsAt: toIso(e.event_end.replace(" ", "T")),
            venueName,
            address,
            lat: null,
            lng: null,
            isFree: cost === 0 ? true : null,
            priceText: cost > 0 ? `$${cost}` : "Free",
            imageUrl: image && /^https?:/.test(image) ? image : null,
            category: null,
          },
        };
      });
  },
};

/**
 * Branch label → display name + a geocodable address. OpenStreetMap knows branches as "<Name> Library",
 * so "Sweet Branch" → "Sweet Library, Salt Lake City"; non-library venues keep their own name.
 */
function place(library: string | undefined, system: string, city: string) {
  const raw = (library ?? "").replace(/^Library\W{1,2}s\s+/i, "").trim();
  if (!raw) return { venueName: system, address: `${system}, ${city}` };
  // OSM names the downtown building after the system; Utah grid street addresses geocode unreliably.
  if (/^main( library)?$/i.test(raw) && city !== "Utah") return { venueName: "Main Library", address: "Salt Lake City Public Library, Salt Lake City, Utah" };
  if (/viridian/i.test(raw)) return { venueName: "Viridian Event Center", address: "Viridian Event Center, West Jordan" };
  const name = raw.replace(/\s+Branch\b/i, "").replace(/\s+Library$/i, "").trim();
  const isLibrary = !/center|lab|hall|park/i.test(name);
  const venueName = isLibrary ? `${name} Library` : name;
  return { venueName, address: `${venueName}, ${city}` };
}

const stripHtml =(s?: string) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
