import {
  Footprints,
  GraduationCap,
  type LucideIcon,
  Mountain,
  MountainSnow,
  MoonStar,
  Music,
  Palette,
  Smile,
  Sparkles,
  Store,
  Trophy,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";
import type { Category } from "@/shared/event";

type Tone = "dark" | "paprika" | "dust";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  dark: { bg: "var(--charcoal)", fg: "var(--dust)" },
  paprika: { bg: "var(--paprika)", fg: "var(--carbon)" },
  dust: { bg: "var(--dust)", fg: "var(--charcoal)" },
};

/** Icon + palette tone per category, used when an event has no image. */
export const CATEGORY_VISUAL: Record<Category | "other", { icon: LucideIcon; tone: Tone }> = {
  music: { icon: Music, tone: "paprika" },
  outdoors: { icon: Mountain, tone: "dark" },
  climbing: { icon: MountainSnow, tone: "paprika" },
  "running-fitness": { icon: Footprints, tone: "dust" },
  "food-drink": { icon: UtensilsCrossed, tone: "paprika" },
  "arts-culture": { icon: Palette, tone: "dust" },
  community: { icon: UsersRound, tone: "dark" },
  sports: { icon: Trophy, tone: "dark" },
  nightlife: { icon: MoonStar, tone: "dark" },
  markets: { icon: Store, tone: "paprika" },
  "learning-talks": { icon: GraduationCap, tone: "dust" },
  family: { icon: Smile, tone: "dust" },
  other: { icon: Sparkles, tone: "dust" },
};

/** Fallback when a source has no image: flat palette block with the category icon. */
export function CategoryArt({ category, className }: { category: Category | null; className?: string }) {
  const v = CATEGORY_VISUAL[category ?? "other"];
  const Icon = v.icon;
  return (
    <div
      aria-hidden
      className={className}
      style={{ background: TONES[v.tone].bg, color: TONES[v.tone].fg }}
    >
      <Icon className="size-1/3 opacity-70" strokeWidth={1.25} />
    </div>
  );
}
