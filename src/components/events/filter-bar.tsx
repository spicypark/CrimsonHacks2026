"use client";

import { ArrowDownUp, Check, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { type Filters, filtersToParams, parseFilters } from "@/lib/events/filters";
import { VIBE_LABELS } from "@/lib/events/format";
import { CATEGORIES, CATEGORY_LABELS, type Category, VIBE_TAGS, type VibeTag } from "@/shared/event";
import { cn } from "@/lib/utils";

const WHEN_OPTIONS: { value: Filters["when"]; label: string }[] = [
  { value: "tonight", label: "Tonight" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
];

const SORT_OPTIONS: { value: Filters["sort"]; label: string }[] = [
  { value: "soon", label: "Starting soonest" },
  { value: "popular", label: "Most popular" },
  { value: "near", label: "Nearest to me" },
  { value: "new", label: "Newly added" },
];

// `relative` keeps sr-only children (absolutely positioned) inside the scrolling pill row instead of widening the page.
const pill =
  "relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors cursor-pointer";
const pillOff = "border-border bg-card text-foreground/90 hover:border-primary/40 hover:bg-accent";
const pillOn = "border-primary bg-primary text-primary-foreground";

/** All list/map filtering UI. State lives in the URL; every change replaces the URL so back/forward and sharing work. */
export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(searchParams);
  const [pending, startTransition] = useTransition();
  const [geoError, setGeoError] = useState<string | null>(null);

  const update = (patch: Partial<Filters>) => {
    const qs = filtersToParams({ ...filters, ...patch }).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const onSearch = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const q = String(new FormData(ev.currentTarget).get("q") ?? "").trim();
    update({ q: q || undefined });
  };

  const setSort = (sort: Filters["sort"]) => {
    setGeoError(null);
    if (sort !== "near") return update({ sort });
    if (!("geolocation" in navigator)) return setGeoError("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (pos) => update({ sort, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeoError("Allow location access to sort by distance."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const extraCount = filters.cat.length + filters.vibe.length + (filters.maybe ? 1 : 0);
  const sortLabel = SORT_OPTIONS.find((s) => s.value === filters.sort)?.label;

  return (
    <div className="space-y-3" data-pending={pending || undefined}>
      <form role="search" onSubmit={onSearch} className="relative">
        <label htmlFor="q" className="sr-only">
          Search events
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id="q"
          name="q"
          key={filters.q ?? ""}
          defaultValue={filters.q ?? ""}
          placeholder="Try “free live music” or “climbing”"
          enterKeyHint="search"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-10 text-base placeholder:text-muted-foreground/80 focus-visible:border-primary focus-visible:outline-none sm:text-sm"
        />
        {filters.q && (
          <button
            type="button"
            onClick={() => update({ q: undefined })}
            aria-label="Clear search"
            className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      <div className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <div role="group" aria-label="When" className="flex gap-2">
          {WHEN_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={filters.when === o.value}
              onClick={() => update({ when: o.value })}
              className={cn(pill, filters.when === o.value ? pillOn : pillOff)}
            >
              {o.label}
            </button>
          ))}
        </div>

        <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden />

        <button
          type="button"
          aria-pressed={!!filters.free}
          onClick={() => update({ free: filters.free ? undefined : "1" })}
          className={cn(pill, filters.free ? pillOn : pillOff)}
        >
          {filters.free && <Check className="size-3.5" aria-hidden />}
          Free only
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(pill, pillOff)}>
              <ArrowDownUp className="size-3.5" aria-hidden />
              <span className="sr-only">Sort: </span>
              {sortLabel}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuRadioGroup value={filters.sort} onValueChange={(v) => setSort(v as Filters["sort"])}>
              {SORT_OPTIONS.map((s) => (
                <DropdownMenuRadioItem key={s.value} value={s.value}>
                  {s.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Sheet>
          <SheetTrigger asChild>
            <button type="button" className={cn(pill, extraCount ? "border-primary/60 bg-card" : pillOff)}>
              <SlidersHorizontal className="size-3.5" aria-hidden />
              Filters
              {extraCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {extraCount}
                </span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle className="font-heading text-xl">Filters</SheetTitle>
              <SheetDescription>Narrow the list by what kind of event it is and what it feels like.</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4">
              <ChipGroup
                legend="Category"
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                selected={filters.cat}
                onToggle={(c: Category) => update({ cat: toggle(filters.cat, c) })}
              />
              <ChipGroup
                legend="Vibe"
                options={VIBE_TAGS.filter((v) => v !== "free").map((v) => ({ value: v, label: VIBE_LABELS[v] }))}
                selected={filters.vibe}
                onToggle={(v: VibeTag) => update({ vibe: toggle(filters.vibe, v) })}
              />
              <fieldset className="space-y-2">
                <legend className="mb-2 font-heading text-sm font-semibold">Unverified events</legend>
                <button
                  type="button"
                  aria-pressed={!!filters.maybe}
                  onClick={() => update({ maybe: filters.maybe ? undefined : "1" })}
                  className={cn(pill, filters.maybe ? pillOn : pillOff)}
                >
                  {filters.maybe && <Check className="size-3.5" aria-hidden />}
                  Show only “maybe” events
                </button>
                <p className="text-xs text-muted-foreground">Posts our AI wasn’t sure are real, public events. Check the source before you go.</p>
              </fieldset>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => update({ cat: [], vibe: [], maybe: undefined })}
                disabled={!extraCount}
              >
                Clear filters
              </Button>
              <SheetClose asChild>
                <Button className="flex-1">Show events</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {geoError && (
        <p role="alert" className="text-sm text-destructive">
          {geoError}
        </p>
      )}

      {(filters.cat.length > 0 || filters.vibe.length > 0) && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {filters.cat.map((c) => (
            <ActiveChip key={c} label={CATEGORY_LABELS[c]} onRemove={() => update({ cat: filters.cat.filter((x) => x !== c) })} />
          ))}
          {filters.vibe.map((v) => (
            <ActiveChip key={v} label={VIBE_LABELS[v]} onRemove={() => update({ vibe: filters.vibe.filter((x) => x !== v) })} />
          ))}
          <li>
            <button
              type="button"
              onClick={() => update({ cat: [], vibe: [] })}
              className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function ChipGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 font-heading text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} onClick={() => onToggle(o.value)} className={cn(pill, on ? pillOn : pillOff)}>
              {on && <Check className="size-3.5" aria-hidden />}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-secondary pr-2 pl-3 text-sm hover:bg-accent"
      >
        {label}
        <X className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Remove filter</span>
      </button>
    </li>
  );
}
