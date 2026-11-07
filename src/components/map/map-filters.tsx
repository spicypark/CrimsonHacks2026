"use client";

import { Check, Search, X } from "lucide-react";
import { VIBE_LABELS } from "@/lib/events/format";
import { TIER_LABELS, TIERS, type Tier } from "@/lib/events/popularity";
import { cn } from "@/lib/utils";
import { CATEGORIES, CATEGORY_LABELS, type Category, VIBE_TAGS, type VibeTag } from "@/shared/event";
import type { PlacedEvent } from "./live-map";

export interface MapFilters {
  q: string;
  cats: Category[];
  vibes: VibeTag[];
  free: boolean;
  /** Empty = every tier. */
  tiers: Tier[];
}

export const EMPTY_FILTERS: MapFilters = { q: "", cats: [], vibes: [], free: false, tiers: [] };

export const activeFilterCount = (f: MapFilters) =>
  f.cats.length + f.vibes.length + f.tiers.length + (f.free ? 1 : 0) + (f.q.trim() ? 1 : 0);

const chip =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors duration-200 select-none";
const chipOff = "border-border bg-card text-ink hover:border-ink-soft";
const chipOn = "border-ink bg-ink text-paper";

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Filters for the live map. Counts are over the whole week so a chip never reads 0 just because of the slider. */
export function MapFilterPanel({
  filters,
  onChange,
  events,
}: {
  filters: MapFilters;
  onChange: (f: MapFilters) => void;
  events: PlacedEvent[];
}) {
  const set = (patch: Partial<MapFilters>) => onChange({ ...filters, ...patch });
  const tierCounts = Map.groupBy(events, (e) => e.tier);
  const catCounts = Map.groupBy(events, (e) => e.category);
  const n = activeFilterCount(filters);

  return (
    <div className="space-y-7 p-4">
      <div className="relative">
        <label htmlFor="map-q" className="sr-only">
          Search events on the map
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
        <input
          id="map-q"
          type="search"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-border bg-card pr-3 pl-9 text-base transition-colors placeholder:text-ink-soft/70 hover:border-ink-soft focus-visible:border-ink focus-visible:outline-none sm:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <fieldset>
        <legend className="mb-3 text-sm font-bold">Popularity</legend>
        <ul className="space-y-1">
          {TIERS.map((tier) => {
            const on = filters.tiers.includes(tier);
            const dim = filters.tiers.length > 0 && !on;
            return (
              <li key={tier}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ tiers: toggle(filters.tiers, tier) })}
                  className={cn(
                    "flex h-10 w-full cursor-pointer items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent",
                    on && "bg-accent font-semibold",
                    dim && "opacity-50",
                  )}
                >
                  <span className="live-pin-swatch" data-tier={tier} aria-hidden />
                  <span className="flex-1">{TIER_LABELS[tier]}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{tierCounts.get(tier)?.length ?? 0}</span>
                  {on && <Check className="size-4" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Based on upvotes, comments and ticket demand where a source reports them.</p>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-bold">Price</legend>
        <button type="button" aria-pressed={filters.free} onClick={() => set({ free: !filters.free })} className={cn(chip, filters.free ? "border-paprika bg-paprika text-carbon" : chipOff)}>
          {filters.free && <Check className="size-4" aria-hidden />}
          Free only
        </button>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-bold">Category</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.filter((c) => catCounts.has(c)).map((c) => {
            const on = filters.cats.includes(c);
            return (
              <button key={c} type="button" aria-pressed={on} onClick={() => set({ cats: toggle(filters.cats, c) })} className={cn(chip, on ? chipOn : chipOff)}>
                {on && <Check className="size-4" aria-hidden />}
                {CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-bold">Vibe</legend>
        <div className="flex flex-wrap gap-2">
          {VIBE_TAGS.filter((v) => v !== "free").map((v) => {
            const on = filters.vibes.includes(v);
            return (
              <button key={v} type="button" aria-pressed={on} onClick={() => set({ vibes: toggle(filters.vibes, v) })} className={cn(chip, on ? chipOn : chipOff)}>
                {on && <Check className="size-4" aria-hidden />}
                {VIBE_LABELS[v]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {n > 0 && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex h-10 cursor-pointer items-center gap-1.5 text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
          Clear {n === 1 ? "filter" : `${n} filters`}
        </button>
      )}
    </div>
  );
}
