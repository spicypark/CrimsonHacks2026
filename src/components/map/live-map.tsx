"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { type Tier, popularityTier } from "@/lib/events/popularity";
import type { Category, VibeTag } from "@/shared/event";
import { EMPTY_FILTERS, MapFilterPanel, type MapFilters, activeFilterCount } from "./map-filters";
import { MapCanvas } from "./map-canvas";
import { LAST_DAY, type Range, rangeWindow } from "./map-time";
import { TimeScrubber } from "./time-scrubber";

/** The slice of an event the map needs. `search` is the pre-lowercased text keyword search runs against. */
export interface MapEvent {
  id: string;
  title: string;
  category: Category | null;
  vibeTags: VibeTag[];
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  lat: number;
  lng: number;
  isFree: boolean | null;
  buzzScore: number | null;
  search: string;
}

export interface PlacedEvent extends MapEvent {
  start: number;
  end: number;
  tier: Tier;
  /** Pixel offset so events sharing one venue fan out instead of stacking on a single point. */
  offset: [number, number];
}

export function LiveMap({ events, now }: { events: MapEvent[]; now: number }) {
  const placed = useMemo(() => place(events), [events]);
  const [filters, setFilters] = useState<MapFilters>(EMPTY_FILTERS);
  const [range, setRangeState] = useState<Range>({ key: "week", from: 0, to: LAST_DAY });
  const win = rangeWindow(range, now);
  const [time, setTime] = useState(win.start);
  const t = Math.min(Math.max(time, win.start), win.end);

  const setRange = (r: Range) => {
    setRangeState(r);
    setTime(rangeWindow(r, now).start);
  };

  const filtered = useMemo(() => placed.filter((e) => matches(e, filters)), [placed, filters]);
  const visible = useMemo(() => new Set(filtered.filter((e) => e.start <= t && t < e.end).map((e) => e.id)), [filtered, t]);

  const filterPanel = <MapFilterPanel filters={filters} onChange={setFilters} events={placed} />;
  const extra = activeFilterCount(filters);

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Map filters" className="hidden w-72 shrink-0 overflow-y-auto border-r border-border bg-background lg:block">
        {filterPanel}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapCanvas events={placed} visibleIds={visible} />
          <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="pointer-events-auto inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-md transition-colors hover:border-ink-soft lg:hidden"
                >
                  <SlidersHorizontal className="size-4" aria-hidden />
                  Filters
                  {extra > 0 && (
                    <span className="grid size-5 place-items-center rounded-sm bg-paprika text-xs font-bold text-carbon">{extra}</span>
                  )}
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-sm" aria-describedby={undefined}>
                <SheetHeader className="pb-0">
                  <SheetTitle className="text-xl font-bold">Filters</SheetTitle>
                </SheetHeader>
                {filterPanel}
              </SheetContent>
            </Sheet>
            <p
              aria-live="polite"
              className="rounded-md border border-border bg-card/95 px-3 py-2 text-sm shadow-md backdrop-blur-sm"
            >
              <strong className="font-bold tabular-nums">{visible.size}</strong>{" "}
              {visible.size === 1 ? "event" : "events"} happening
            </p>
          </div>
        </div>

        <TimeScrubber
          now={now}
          start={win.start}
          end={win.end}
          time={t}
          onTime={setTime}
          range={range}
          onRange={setRange}
          events={filtered}
        />
      </div>
    </div>
  );
}

function matches(e: PlacedEvent, f: MapFilters): boolean {
  if (f.free && !e.isFree) return false;
  if (f.cats.length && (!e.category || !f.cats.includes(e.category))) return false;
  if (!f.vibes.every((v) => e.vibeTags.includes(v))) return false;
  if (f.tiers.length && !f.tiers.includes(e.tier)) return false;
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => e.search.includes(w));
}

/** Parse times once and fan out events that share a coordinate around a small ring. */
function place(events: MapEvent[]): PlacedEvent[] {
  const byPoint = Map.groupBy(events, (e) => `${e.lat.toFixed(4)},${e.lng.toFixed(4)}`);
  const offsets = new Map<string, [number, number]>();
  for (const group of byPoint.values()) {
    const r = group.length > 1 ? Math.min(8 + group.length * 1.5, 26) : 0;
    group.forEach((e, i) => {
      const a = (2 * Math.PI * i) / group.length - Math.PI / 2;
      offsets.set(e.id, [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]);
    });
  }
  return events.map((e) => ({
    ...e,
    start: new Date(e.startsAt).getTime(),
    end: new Date(e.endsAt).getTime(),
    tier: popularityTier(e.buzzScore),
    offset: offsets.get(e.id) ?? [0, 0],
  }));
}
