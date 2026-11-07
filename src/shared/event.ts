import { z } from "zod";

/** Fixed category list — drives the filter UI and the AI extraction schema. */
export const CATEGORIES = [
  "music",
  "outdoors",
  "climbing",
  "running-fitness",
  "food-drink",
  "arts-culture",
  "community",
  "sports",
  "nightlife",
  "markets",
  "learning-talks",
  "family",
] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const CATEGORY_LABELS: Record<Category, string> = {
  music: "Music",
  outdoors: "Outdoors",
  climbing: "Climbing",
  "running-fitness": "Running & Fitness",
  "food-drink": "Food & Drink",
  "arts-culture": "Arts & Culture",
  community: "Community",
  sports: "Sports",
  nightlife: "Nightlife",
  markets: "Markets",
  "learning-talks": "Learning & Talks",
  family: "Family",
};

/** AI-assigned vibe tags (multi-select). */
export const VIBE_TAGS = [
  "free",
  "beginner-friendly",
  "meet-people",
  "go-solo",
  "family-friendly",
  "21-plus",
  "dog-friendly",
  "outdoorsy",
  "chill",
  "high-energy",
  "student",
] as const;
export const VibeTag = z.enum(VIBE_TAGS);
export type VibeTag = z.infer<typeof VibeTag>;

export const SOURCE_TYPES = ["reddit", "ticketmaster", "seatgeek", "ical", "webpage"] as const;
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;

/** Engagement as reported by a source. Absent fields = source doesn't report it (never fake a 0). */
export const Engagement = z.object({
  upvotes: z.number().int().optional(),
  comments: z.number().int().optional(),
  popularity: z.number().optional(), // e.g. SeatGeek score 0..1
});
export type Engagement = z.infer<typeof Engagement>;

/** Typical durations used when a source gives no end time (ms). */
export const DEFAULT_DURATION_MS: Record<Category, number> = {
  music: 3 * 3600e3,
  outdoors: 3 * 3600e3,
  climbing: 2.5 * 3600e3,
  "running-fitness": 1.5 * 3600e3,
  "food-drink": 3 * 3600e3,
  "arts-culture": 2 * 3600e3,
  community: 2 * 3600e3,
  sports: 3 * 3600e3,
  nightlife: 4 * 3600e3,
  markets: 4 * 3600e3,
  "learning-talks": 1.5 * 3600e3,
  family: 2 * 3600e3,
};

/**
 * The single event shape every connector + extraction step produces.
 * Times are ISO-8601 strings with offset (America/Denver unless the source says otherwise).
 */
export const NormalizedEvent = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venueName: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isFree: z.boolean().nullable(),
  priceText: z.string().nullable(),
  imageUrl: z.string().nullable(),
  category: Category.nullable(),
});
export type NormalizedEvent = z.infer<typeof NormalizedEvent>;

/**
 * What a connector returns for each item it finds.
 * Structured sources fill `event`; unstructured sources (Reddit, plain pages) leave it null
 * and provide `text` for AI extraction.
 */
export interface RawItem {
  externalId: string;
  url: string;
  text: string;
  event: NormalizedEvent | null;
  engagement: Engagement;
  postedAt: string | null;
}
