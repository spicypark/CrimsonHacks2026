import * as cheerio from "cheerio";
import type { NormalizedEvent, RawItem } from "@/shared/event";
import { toIso } from "@/shared/time";
import { getText } from "./http";
import type { Connector } from "./types";

type Json = Record<string, unknown>;

/**
 * Any public events web page. schema.org/Event JSON-LD first (structured, free);
 * if the page has none, return the page text as one unstructured item for AI extraction.
 * source.target = page URL.
 */
export const webpage: Connector = {
  type: "webpage",
  async fetch(source) {
    const html = await getText(source.target);
    const $ = cheerio.load(html);

    const ldEvents = $('script[type="application/ld+json"]')
      .toArray()
      .flatMap((el) => {
        try {
          return flattenLd(JSON.parse($(el).text()));
        } catch {
          return [];
        }
      })
      .filter(isEventNode);

    if (ldEvents.length) {
      return ldEvents
        .map((node, i) => fromLd(node, source.target, i))
        .filter((x): x is RawItem => x !== null);
    }

    $("script, style, nav, footer, header, noscript, svg").remove();
    const text = $("main").text() || $("body").text();
    return [
      {
        externalId: source.target,
        url: source.target,
        text: `Page: ${$("title").text().trim()}\n${text.replace(/\s+/g, " ").trim()}`.slice(0, 15_000),
        postedAt: null,
        engagement: {},
        event: null,
      },
    ];
  },
};

function flattenLd(node: unknown): Json[] {
  if (Array.isArray(node)) return node.flatMap(flattenLd);
  if (node && typeof node === "object") {
    const obj = node as Json;
    return [obj, ...(obj["@graph"] ? flattenLd(obj["@graph"]) : [])];
  }
  return [];
}

const isEventNode = (n: Json) => {
  const t = n["@type"];
  return (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && /Event$/.test(x));
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

function fromLd(n: Json, pageUrl: string, index: number): RawItem | null {
  const title = str(n.name);
  const startsAt = toIso(str(n.startDate));
  if (!title || !startsAt) return null;

  const loc = first(n.location) as Json | undefined;
  const addr = loc?.address;
  const address =
    typeof addr === "string"
      ? addr
      : addr && typeof addr === "object"
        ? ["streetAddress", "addressLocality", "addressRegion"].map((k) => str((addr as Json)[k])).filter(Boolean).join(", ")
        : null;
  const geo = loc?.geo as Json | undefined;
  const offer = first(n.offers) as Json | undefined;
  const price = offer ? Number(offer.price ?? offer.lowPrice) : NaN;
  const img = first(n.image);

  const event: NormalizedEvent = {
    title,
    description: str(n.description) ?? "",
    startsAt,
    endsAt: toIso(str(n.endDate)),
    venueName: str(loc?.name),
    address: address || null,
    lat: geo?.latitude != null ? Number(geo.latitude) : null,
    lng: geo?.longitude != null ? Number(geo.longitude) : null,
    isFree: n.isAccessibleForFree === true || price === 0 ? true : Number.isFinite(price) && price > 0 ? false : null,
    priceText: Number.isFinite(price) ? (price === 0 ? "Free" : `$${price}`) : null,
    imageUrl: typeof img === "string" ? img : str((img as Json | undefined)?.url),
    category: null,
  };
  const url = str(n.url) ?? pageUrl;
  return {
    externalId: `${url}#${startsAt}#${index}`,
    url,
    text: `${title}\n${event.description}`.slice(0, 4000),
    postedAt: null,
    engagement: {},
    event,
  };
}
