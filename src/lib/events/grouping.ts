import { dayKey } from "./format";
import type { EventView } from "./query";

/**
 * One slot in a day's list: a single event, or several events condensed into a tile.
 * A tile is either a library system (all its branches together) or one venue.
 */
export type ListItem =
  | { kind: "event"; event: EventView }
  | { kind: "venue"; venue: string; system: boolean; events: EventView[] };

/** Library programs are many and small, so they condense sooner than other venues. */
const LIBRARY_MIN = 2;
const VENUE_MIN = 4;

const isLibrary = (venue: string) => /\blibrary\b/i.test(venue);
export const venueKey = (venue: string) => venue.trim().toLowerCase();

interface Cluster {
  key: string;
  name: string;
  min: number;
  system: boolean;
}

/**
 * What an event condenses under. Events from a library calendar (communico) group by library
 * system across all its branches; anything else groups by its venue.
 */
export function clusterOf(e: EventView): Cluster | null {
  const library = e.sources.find((s) => s.type === "communico");
  if (library) return { key: venueKey(library.label), name: library.label, min: LIBRARY_MIN, system: true };
  const venue = e.venueName?.trim();
  if (!venue) return null;
  return { key: venueKey(venue), name: venue, min: isLibrary(venue) ? LIBRARY_MIN : VENUE_MIN, system: false };
}

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
 * Condenses one day's events: clusters at or over their minimum become a single tile,
 * placed where the cluster's first event would have been. Everything else stays as-is.
 */
export function clusterByVenue(events: EventView[]): ListItem[] {
  const clusters = events.map(clusterOf);
  const byKey = new Map<string, EventView[]>();
  events.forEach((e, i) => {
    const c = clusters[i];
    if (c) byKey.set(c.key, [...(byKey.get(c.key) ?? []), e]);
  });

  const items: ListItem[] = [];
  const placed = new Set<string>();
  events.forEach((e, i) => {
    const c = clusters[i];
    const group = c && byKey.get(c.key);
    if (!c || !group || group.length < c.min) {
      items.push({ kind: "event", event: e });
      return;
    }
    if (placed.has(c.key)) return;
    placed.add(c.key);
    items.push({ kind: "venue", venue: c.name, system: c.system, events: group });
  });
  return items;
}
