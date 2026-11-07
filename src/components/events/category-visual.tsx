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

/** Icon + two-stop gradient per category, used for image fallbacks and category chips. */
export const CATEGORY_VISUAL: Record<Category | "other", { icon: LucideIcon; from: string; to: string }> = {
  music: { icon: Music, from: "#5b2a86", to: "#ff7a5c" },
  outdoors: { icon: Mountain, from: "#1f4d4a", to: "#9ccfa8" },
  climbing: { icon: MountainSnow, from: "#7a3220", to: "#f2b35b" },
  "running-fitness": { icon: Footprints, from: "#24406e", to: "#7fb3ff" },
  "food-drink": { icon: UtensilsCrossed, from: "#7a2e2e", to: "#f2b35b" },
  "arts-culture": { icon: Palette, from: "#4a2a6e", to: "#d78af0" },
  community: { icon: UsersRound, from: "#2e3f6e", to: "#f2b35b" },
  sports: { icon: Trophy, from: "#7a4a12", to: "#ffd27a" },
  nightlife: { icon: MoonStar, from: "#1c1550", to: "#8f86d6" },
  markets: { icon: Store, from: "#6e3a1f", to: "#ffb07a" },
  "learning-talks": { icon: GraduationCap, from: "#20405a", to: "#9ccfa8" },
  family: { icon: Smile, from: "#6e2a4a", to: "#ffb0c4" },
  other: { icon: Sparkles, from: "#2b2752", to: "#a9a4c4" },
};

/** Designed fallback when a source has no image: category gradient with a large icon. */
export function CategoryArt({ category, className }: { category: Category | null; className?: string }) {
  const v = CATEGORY_VISUAL[category ?? "other"];
  const Icon = v.icon;
  return (
    <div
      aria-hidden
      className={className}
      style={{ background: `linear-gradient(135deg, ${v.from} 0%, ${v.to} 140%)` }}
    >
      <Icon className="size-1/2 text-white/35" strokeWidth={1.25} />
    </div>
  );
}
