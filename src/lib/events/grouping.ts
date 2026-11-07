import { dayKey } from "./format";
import type { EventView } from "./query";

/** One slot in a day's list: a single event, or several events at one venue condensed into a tile. */
export type ListItem =
  | { kind: "event"; event: EventView }
  | { kind: "venue"; venue: string; events: EventView[] };

/** Library branches post many small events, so they condense sooner than other venues. */
const LIBRARY_MIN = 2;
const VENUE_MIN = 4;

const isLibrary = (venue: string) => /\blibrary\b/i.test(venue);
export const venueKey = (venue: string) => venue.trim().toLowerCase();

/** How many events one venue needs on a day before they condense into a tile. */
export const clusterMin = (venue: string) => (isLibrary(venue) ? LIBRARY_MIN : VENUE_MIN);

/** The list day an event belongs to (Utah calendar day); events already underway count as today. */
export const listDay = (e: EventView, now: number) => {
  const nowIso = new Date(now).toISOString();
  return dayKey(e.startsAt < nowIso ? nowIso : e.startsAt);
};

/** Groups by list day, keeping the incoming order within each day. */
export function groupByDay(events: EventView[], now: number): [string, EventView[]][] {
  const groups = new Map<string, EventView[]>();
  for (const e of events) {
    const key = listDay(e, now);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()];
}

/**
 * Condenses one day's events: venues at or over their `clusterMin` become a single tile,
 * placed where that venue's first event would have been. Everything else stays as-is.
 */
export function clusterByVenue(events: EventView[]): ListItem[] {
  const byVenue = new Map<string, EventView[]>();
  for (const e of events) {
    if (!e.venueName?.trim()) continue;
    const k = venueKey(e.venueName);
    byVenue.set(k, [...(byVenue.get(k) ?? []), e]);
  }

  const items: ListItem[] = [];
  const placed = new Set<string>();
  for (const e of events) {
    const group = e.venueName?.trim() ? byVenue.get(venueKey(e.venueName)) : undefined;
    if (!group || group.length < clusterMin(e.venueName!)) {
      items.push({ kind: "event", event: e });
      continue;
    }
    const k = venueKey(e.venueName!);
    if (placed.has(k)) continue;
    placed.add(k);
    items.push({ kind: "venue", venue: e.venueName!.trim(), events: group });
  }
  return items;
}
