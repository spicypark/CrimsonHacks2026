import type { Filters } from "@/lib/events/filters";
import { type EventView, queryEvents } from "@/lib/events/query";
import { topicFilter } from "@/lib/search/topic";
import { VIBE_LABELS } from "@/lib/events/format";

/** One pass of the list query: SQL filters, then topic words matched by meaning. */
export async function findEvents(f: Filters): Promise<EventView[]> {
  const candidates = queryEvents({ ...f, q: undefined });
  return f.q ? topicFilter(f.q, candidates) : candidates;
}

const WIDER: Partial<Record<Filters["when"], { when: Filters["when"]; label: string }>> = {
  now: { when: "today", label: "later today" },
  today: { when: "week", label: "this week" },
  tonight: { when: "week", label: "this week" },
  tomorrow: { when: "week", label: "this week" },
  weekend: { when: "week", label: "this week" },
  week: { when: "month", label: "in the next 30 days" },
};

export interface SearchResult {
  events: EventView[];
  /** Set when nothing matched exactly and a looser search was shown instead: what was loosened, for a notice. */
  relaxed: string | null;
  /** The time window the events were found in (wider than the search's own when relaxed). */
  when: Filters["when"];
}

/**
 * The AI turns a sentence into several hard filters at once (topic + vibe + category + time), and every one of
 * them is an AND: "chill bar tonight" needs nightlife AND chill-tagged AND tonight, which is often nothing.
 * For AI searches (`ask` set) an empty result is retried with the guessed extras dropped one at a time, then
 * a wider time window, and the page says what was loosened. Hand-picked filters (no `ask`) are left alone.
 */
export async function searchEvents(f: Filters): Promise<SearchResult> {
  const exact = await findEvents(f);
  if (exact.length || !f.ask) return { events: exact, relaxed: null, when: f.when };

  const steps: { patch: Partial<Filters>; note: string }[] = [];
  if (f.vibe.length) steps.push({ patch: { vibe: [] }, note: `without "${f.vibe.map((v) => VIBE_LABELS[v] ?? v).join(", ")}"` });
  if (f.cat.length && (f.q || f.vibe.length || f.free)) steps.push({ patch: { cat: [] }, note: "in any category" });
  const wider = WIDER[f.when];
  if (wider) steps.push({ patch: { when: wider.when }, note: wider.label });

  let current = f;
  const notes: string[] = [];
  for (const step of steps) {
    current = { ...current, ...step.patch };
    notes.push(step.note);
    const events = await findEvents(current);
    if (events.length) return { events, relaxed: notes.join(", "), when: current.when };
  }
  return { events: [], relaxed: null, when: f.when };
}
