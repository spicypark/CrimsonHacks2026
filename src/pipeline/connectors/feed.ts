import * as cheerio from "cheerio";
import ical, { type ParameterValue, type VEvent } from "node-ical";
import type { RawItem } from "@/shared/event";
import { toIso } from "@/shared/time";
import { getText } from "./http";
import type { Connector } from "./types";

const WINDOW_DAYS = 30;
/** Long-running entries ("applications open", exhibits spanning weeks) aren't something you pull up to tonight. */
const MAX_DURATION_MS = 3 * 864e5;

const pv = (v: ParameterValue | undefined): string =>
  v == null ? "" : typeof v === "string" ? v : String(v.val ?? "");

/**
 * Calendar feeds: iCal (.ics) is structured and maps straight to events;
 * RSS/Atom items are unstructured and go through AI extraction.
 * source.target = feed URL.
 */
export const feed: Connector = {
  type: "ical",
  async fetch(source) {
    const body = await getText(source.target);
    return body.trimStart().startsWith("BEGIN:VCALENDAR") ? fromIcs(body, source.target) : fromRss(body);
  },
};

function fromIcs(body: string, feedUrl: string): RawItem[] {
  const from = new Date();
  const to = new Date(Date.now() + WINDOW_DAYS * 864e5);
  const items: RawItem[] = [];

  for (const comp of Object.values(ical.sync.parseICS(body))) {
    if (comp?.type !== "VEVENT") continue;
    const ev = comp as VEvent;
    const occurrences = ev.rrule
      ? ical.expandRecurringEvent(ev, { from, to }).map((i) => ({ start: i.start as Date, end: i.end as Date }))
      : [{ start: ev.start as Date, end: ev.end as Date }];

    for (const occ of occurrences) {
      if (!occ.start || occ.start < from || occ.start > to) continue;
      if (occ.end && occ.end.getTime() - occ.start.getTime() > MAX_DURATION_MS) continue;
      const title = pv(ev.summary).trim();
      if (!title) continue;
      const description = pv(ev.description).replace(/<[^>]+>/g, " ").trim();
      const location = pv(ev.location).trim();
      items.push({
        externalId: `${ev.uid}@${occ.start.toISOString()}`,
        url: ev.url ? pv(ev.url as ParameterValue) : feedUrl,
        text: [title, location, description].filter(Boolean).join("\n").slice(0, 4000),
        postedAt: null,
        engagement: {},
        event: {
          title,
          description,
          startsAt: toIso(occ.start)!,
          endsAt: toIso(occ.end),
          venueName: location ? location.split(",")[0].trim() : null,
          address: location || null,
          lat: ev.geo?.lat ?? null,
          lng: ev.geo?.lon ?? null,
          isFree: null,
          priceText: null,
          imageUrl: null,
          category: null, // AI enrichment fills category + tags
        },
      });
    }
  }
  return items;
}

function fromRss(body: string): RawItem[] {
  const $ = cheerio.load(body, { xml: true });
  return $("item, entry")
    .toArray()
    .map((el): RawItem => {
      const node = $(el);
      const link = node.find("link").first();
      const url = link.attr("href") ?? link.text().trim();
      const title = node.find("title").first().text().trim();
      const content = cheerio
        .load(node.find("content\\:encoded, description, summary, content").first().text())
        .text()
        .replace(/\s+/g, " ")
        .trim();
      return {
        externalId: node.find("guid, id").first().text().trim() || url,
        url,
        text: `${title}\n${content}`.slice(0, 4000),
        postedAt: toIso(node.find("pubDate, published, updated").first().text().trim()),
        engagement: {},
        event: null,
      };
    })
    .filter((i) => i.url);
}
