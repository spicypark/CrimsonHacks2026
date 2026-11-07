/**
 * Popularity tiers for map pins, from buzz_score (0–100 percentile of source engagement).
 * Most events come from sources that report no engagement, so "unrated" is its own tier, not "quiet".
 */
export const TIERS = ["hot", "popular", "quiet", "unrated"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  hot: "Hot",
  popular: "Popular",
  quiet: "Low buzz",
  unrated: "No data",
};

export function popularityTier(buzzScore: number | null): Tier {
  if (buzzScore == null) return "unrated";
  if (buzzScore >= 70) return "hot";
  if (buzzScore >= 35) return "popular";
  return "quiet";
}
