import { z } from "zod";
import { generateJson } from "@/lib/ai/llm";
import { Category, CATEGORIES, type NormalizedEvent, type RawItem, VibeTag, VIBE_TAGS } from "@/shared/event";
import { TIME_ZONE, toIso } from "@/shared/time";

/** An event ready for geocoding + merging: normalized fields plus AI enrichment. */
export interface CandidateEvent extends NormalizedEvent {
  summary: string;
  vibeTags: VibeTag[];
  confidence: number;
}

const LOCAL_TIME = z.string().describe("Utah local time, format YYYY-MM-DDTHH:mm (no timezone)");

const Enrichment = z.object({
  isPublicEvent: z.boolean().describe("true only if anyone from the public can attend (free or by buying a ticket)"),
  confidence: z.number().min(0).max(1).describe("how sure you are this is a real, public, upcoming event"),
  category: Category,
  vibeTags: z.array(VibeTag).max(5),
  summary: z
    .string()
    .describe("2-3 plain-English sentences: what it is, who it's for, cost, what to bring. No hype."),
});

const ExtractedEvent = Enrichment.extend({
  title: z.string(),
  startsAt: LOCAL_TIME,
  endsAt: LOCAL_TIME.nullable(),
  venueName: z.string().nullable(),
  address: z.string().nullable().describe("street address or best location description incl. city, Utah"),
  isFree: z.boolean().nullable(),
  priceText: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

const SYSTEM = `You extract public events in Utah's Wasatch Front (Ogden–Salt Lake City–Provo) from messy posts, flyers and web pages.
Rules:
- Only events with a specific date that members of the public can attend (open invite, or tickets on sale to anyone).
- Exclude: private gatherings, lost & found, questions ("anyone know..."), job posts, recurring business hours, events outside Utah.
- Resolve relative dates ("this Saturday", "tomorrow") against the posted date. All times are ${TIME_ZONE}.
- Never invent details. Unknown → null. If no time is given, use 19:00 and lower confidence.
- category must be one of: ${CATEGORIES.join(", ")}.
- vibeTags (0-5) from: ${VIBE_TAGS.join(", ")}. Use "free" only if it is explicitly free.`;

const today = () =>
  new Date().toLocaleString("en-US", { timeZone: TIME_ZONE, dateStyle: "full", timeStyle: "short" });

/** Unstructured item (Reddit post, RSS item, plain page) → 0..n candidate events. */
export async function extractEvents(item: RawItem): Promise<CandidateEvent[]> {
  const { events } = await generateJson({
    task: "extract",
    system: SYSTEM,
    schema: z.object({ events: z.array(ExtractedEvent).max(25) }),
    prompt: `Today is ${today()}.\nPosted: ${item.postedAt ?? "unknown"}\nSource URL: ${item.url}\n\n---\n${item.text}`,
  });

  return events.flatMap((e): CandidateEvent[] => {
    const startsAt = toIso(e.startsAt);
    if (!e.isPublicEvent || !startsAt) return [];
    return [
      {
        title: e.title,
        description: "",
        startsAt,
        endsAt: toIso(e.endsAt),
        venueName: e.venueName,
        address: e.address,
        lat: null,
        lng: null,
        isFree: e.isFree,
        priceText: e.priceText,
        imageUrl: e.imageUrl,
        category: e.category,
        summary: e.summary,
        vibeTags: e.vibeTags,
        confidence: e.confidence,
      },
    ];
  });
}

/**
 * Structured items (already have title/time/venue) → add category, tags, summary, confidence. Batched to save calls.
 * Returns one entry per input, in order; null = AI judged it not a public event.
 */
export async function enrichEvents(batch: NormalizedEvent[]): Promise<(CandidateEvent | null)[]> {
  if (!batch.length) return [];
  const { results } = await generateJson({
    task: "enrich",
    system: SYSTEM,
    schema: z.object({ results: z.array(Enrichment.extend({ index: z.number().int() })) }),
    prompt: `Today is ${today()}. For each event below return one result with the same index.\n\n${batch
      .map(
        (e, i) =>
          `#${i}: ${e.title} | ${e.startsAt} | ${e.venueName ?? "?"} | ${e.priceText ?? "price unknown"}\n${e.description.slice(0, 600)}`,
      )
      .join("\n\n")}`,
  });

  const byIndex = new Map(results.map((r) => [r.index, r]));
  return batch.map((e, i): CandidateEvent | null => {
    const r = byIndex.get(i);
    if (r && !r.isPublicEvent) return null;
    return {
      ...e,
      isFree: e.isFree ?? (r?.vibeTags.includes("free") ? true : null),
      category: e.category ?? r?.category ?? null,
      summary: r?.summary ?? e.description.slice(0, 280),
      vibeTags: r?.vibeTags ?? [],
      // Structured listings from ticketing/calendar sources are real by construction.
      confidence: Math.max(r?.confidence ?? 0.9, 0.85),
    };
  });
}
