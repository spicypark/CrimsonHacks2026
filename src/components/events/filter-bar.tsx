"use client";

import { ArrowDownUp, Check, Loader2, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { CATEGORY_VISUAL } from "@/components/events/category-visual";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { type Filters, filtersToParams, parseFilters } from "@/lib/events/filters";
import { VIBE_LABELS } from "@/lib/events/format";
import { CATEGORIES, CATEGORY_LABELS, type Category, VIBE_TAGS, type VibeTag } from "@/shared/event";
import { cn } from "@/lib/utils";

const DEFAULT_WHEN: Filters["when"] = "week";

/** Every date window; the sheet lists all of them. */
const WHEN_OPTIONS: { value: Filters["when"]; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "Next 7 days" },
  { value: "month", label: "Next 30 days" },
];

/** The one-tap date choices in the bar. "Today" is in the sheet; "Tonight" covers the common case. */
const QUICK_WHEN: { value: Filters["when"]; label: string }[] = [
  { value: "tonight", label: "Tonight" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "weekend", label: "Weekend" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const SORT_OPTIONS: { value: Filters["sort"]; label: string }[] = [
  { value: "soon", label: "Soonest" },
  { value: "popular", label: "Popular" },
  { value: "near", label: "Nearest" },
  { value: "new", label: "Newest" },
];

// `relative` keeps sr-only children (absolutely positioned) inside the scrolling row instead of widening the page.
const pill =
  "relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3.5 text-sm font-semibold transition-colors duration-200 select-none";
const pillOff = "border-border bg-card text-ink hover:border-ink-soft";
const pillOn = "border-ink bg-ink text-paper";

/**
 * All list filtering UI. State lives in the URL; every change replaces the URL so back/forward and sharing work.
 *
 * Layout: search + sort + "Filters" on top; below, the filters people flip constantly — when, free, category —
 * as one-tap controls. Vibes, "Today", and unconfirmed events live in the Filters sheet.
 */
export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(searchParams);
  const [pending, startTransition] = useTransition();
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const update = (patch: Partial<Filters>) => {
    const qs = filtersToParams({ ...filters, ...patch }).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /** Everything a search sets, cleared together so a new search starts fresh. */
  const SEARCH_RESET: Partial<Filters> = { q: undefined, ask: undefined, near: undefined, cat: [], vibe: [], free: undefined, when: DEFAULT_WHEN };
  const placeReset = (): Partial<Filters> => (filters.near ? { near: undefined, lat: undefined, lng: undefined } : {});

  const onSearch = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const text = String(new FormData(ev.currentTarget).get("q") ?? "").trim();
    setGeoError(null);
    if (!text) return update({ ...SEARCH_RESET, ...placeReset() });
    setSearching(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text }),
      });
      const plan = (await res.json()) as { filters: Partial<Filters>; nearMe: boolean };
      const next = { ...SEARCH_RESET, ...placeReset(), ...plan.filters };
      if (plan.nearMe) withLocation((lat, lng) => update({ ...next, sort: "near", lat, lng }), () => update(next));
      else update(next);
    } catch {
      update({ ...SEARCH_RESET, ...placeReset(), ask: text, q: text });
    } finally {
      setSearching(false);
    }
  };

  const withLocation = (ok: (lat: number, lng: number) => void, fail?: () => void) => {
    if (!("geolocation" in navigator)) {
      setGeoError("Location isn't available in this browser.");
      return fail?.();
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => ok(pos.coords.latitude, pos.coords.longitude),
      () => {
        setGeoError("Turn on location to sort by distance.");
        fail?.();
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const setSort = (sort: Filters["sort"]) => {
    setGeoError(null);
    if (sort !== "near") return update({ sort });
    withLocation((lat, lng) => update({ sort, lat, lng, near: undefined }));
  };

  /** Tapping the selected date again goes back to the default window, so a date choice is never a dead end. */
  const setWhen = (when: Filters["when"]) => update({ when: filters.when === when ? DEFAULT_WHEN : when });

  const searchText = filters.ask ?? filters.q ?? "";
  const busy = pending || searching;

  // Only filters you can't see in the bar count toward the badge.
  const hiddenCount = filters.vibe.length + (filters.maybe ? 1 : 0) + (filters.when === "today" ? 1 : 0);
  const sortLabel = SORT_OPTIONS.find((s) => s.value === filters.sort)?.label;
  // Selected categories move to the front so they're never scrolled out of view.
  const categories = [...filters.cat, ...CATEGORIES.filter((c) => !filters.cat.includes(c))];
  const anyActive =
    !!filters.q || !!filters.near || filters.cat.length > 0 || filters.vibe.length > 0 || !!filters.free || !!filters.maybe || filters.when !== DEFAULT_WHEN;

  return (
    <div className="relative space-y-3" aria-busy={busy}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 -bottom-3 h-0.5 bg-paprika transition-opacity duration-200",
          busy ? "animate-pulse opacity-100" : "opacity-0",
        )}
      />

      {/* Row 1: search, sort, everything else. */}
      <div className="flex items-center gap-2">
        <form role="search" onSubmit={onSearch} className="relative min-w-0 flex-1">
          <label htmlFor="q" className="sr-only">
            Search events
          </label>
          {searching ? (
            <Loader2 className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 animate-spin text-paprika" aria-hidden />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          )}
          <input
            id="q"
            name="q"
            key={searchText}
            defaultValue={searchText}
            placeholder="Try “free music tonight”"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={200}
            readOnly={searching}
            className="h-11 w-full rounded-md border border-border bg-card pr-11 pl-10 text-base transition-colors duration-200 placeholder:text-ink-soft/70 hover:border-ink-soft focus-visible:border-ink focus-visible:outline-none sm:text-sm"
          />
          {searching && <span className="sr-only" role="status">Searching</span>}
          {searchText && !searching && (
            <button
              type="button"
              onClick={() => update({ ...SEARCH_RESET, ...placeReset() })}
              aria-label="Clear search"
              className="absolute top-1/2 right-0.5 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-ink-soft transition-colors hover:text-ink"
            >
              <X className="size-4" />
            </button>
          )}
        </form>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(pill, pillOff, "h-11")} aria-label={`Sort: ${sortLabel}`}>
              <ArrowDownUp className="size-4" aria-hidden />
              <span className="hidden sm:inline">{sortLabel}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
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
            <button type="button" className={cn(pill, "h-11", hiddenCount ? "border-ink bg-card text-ink" : pillOff)}>
              <SlidersHorizontal className="size-4" aria-hidden />
              <span className="hidden sm:inline">Filters</span>
              {hiddenCount > 0 ? (
                <span className="grid size-5 place-items-center rounded-sm bg-paprika text-xs font-bold text-carbon">
                  {hiddenCount}
                  <span className="sr-only"> more filters on</span>
                </span>
              ) : (
                <span className="sr-only sm:hidden">Filters</span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" aria-describedby={undefined}>
            <SheetHeader>
              <SheetTitle className="text-xl font-bold">Filters</SheetTitle>
            </SheetHeader>
            <div className="space-y-7 px-4">
              <fieldset>
                <legend className="mb-3 text-sm font-bold">When</legend>
                <div className="flex flex-wrap gap-2">
                  {WHEN_OPTIONS.map((o) => {
                    const on = filters.when === o.value;
                    return (
                      <button key={o.value} type="button" aria-pressed={on} onClick={() => update({ when: o.value })} className={cn(pill, on ? pillOn : pillOff)}>
                        {on && <Check className="size-4" aria-hidden />}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <ChipGroup
                legend="Vibe"
                options={VIBE_TAGS.filter((v) => v !== "free").map((v) => ({ value: v, label: VIBE_LABELS[v] }))}
                selected={filters.vibe}
                onToggle={(v: VibeTag) => update({ vibe: toggle(filters.vibe, v) })}
              />
              <ChipGroup
                legend="Category"
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                selected={filters.cat}
                onToggle={(c: Category) => update({ cat: toggle(filters.cat, c) })}
              />
              <fieldset>
                <legend className="mb-3 text-sm font-bold">Other</legend>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={!!filters.free}
                    onClick={() => update({ free: filters.free ? undefined : "1" })}
                    className={cn(pill, filters.free ? pillOn : pillOff)}
                  >
                    {filters.free && <Check className="size-4" aria-hidden />}
                    Free only
                  </button>
                  <button
                    type="button"
                    aria-pressed={!!filters.maybe}
                    onClick={() => update({ maybe: filters.maybe ? undefined : "1" })}
                    className={cn(pill, filters.maybe ? pillOn : pillOff)}
                  >
                    {filters.maybe && <Check className="size-4" aria-hidden />}
                    Unconfirmed only
                  </button>
                </div>
              </fieldset>
            </div>
            <SheetFooter className="flex-row gap-2">
              <Button
                variant="outline"
                className="h-11 flex-1 cursor-pointer"
                onClick={() => update({ ...SEARCH_RESET, ...placeReset(), maybe: undefined })}
                disabled={!anyActive}
              >
                Reset all
              </Button>
              <SheetClose asChild>
                <Button className="h-11 flex-1 cursor-pointer">Done</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* Row 2: one-tap filters. Phones: dates get their own full-width row; the rest scrolls sideways. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div role="group" aria-label="When" className="flex shrink-0 rounded-md border border-border bg-card p-0.5">
          {QUICK_WHEN.map((o) => {
            const on = filters.when === o.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => setWhen(o.value)}
                className={cn(
                  "h-9 flex-1 cursor-pointer rounded-[5px] px-1 text-[13px] font-semibold transition-colors duration-200 select-none sm:flex-none sm:px-3 sm:text-sm",
                  on ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
                )}
              >
                {o.label}
              </button>
            );
          })}
          {filters.when === "today" && (
            <button
              type="button"
              aria-pressed
              onClick={() => setWhen("today")}
              className="h-9 flex-1 cursor-pointer rounded-[5px] bg-ink px-1 text-[13px] font-semibold text-paper sm:flex-none sm:px-3 sm:text-sm"
            >
              Today
            </button>
          )}
        </div>
  
        {/* The fade on the right hints there's more to scroll. */}
        <div className="-mx-4 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:-mr-6 sm:pr-6 sm:pl-0 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]">
          <button
            type="button"
            aria-pressed={!!filters.free}
            onClick={() => update({ free: filters.free ? undefined : "1" })}
            className={cn(pill, filters.free ? "border-paprika bg-paprika text-carbon" : pillOff)}
          >
            {filters.free && <Check className="size-4" aria-hidden />}
            Free
          </button>
  
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
  
          <div role="group" aria-label="Category" className="flex gap-2 pr-8">
            {categories.map((c) => {
              const on = filters.cat.includes(c);
              const Icon = CATEGORY_VISUAL[c].icon;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ cat: toggle(filters.cat, c) })}
                  className={cn(pill, on ? pillOn : pillOff)}
                >
                  <Icon className={cn("size-4", on ? "text-paprika" : "text-ink-soft")} aria-hidden />
                  {CATEGORY_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {geoError && (
        <p role="alert" className="text-sm text-destructive">
          {geoError}
        </p>
      )}

      {/* Chips for what's set but not visible in the bar. */}
      {(filters.vibe.length > 0 || filters.near || filters.q || filters.maybe) && (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Active filters">
          {filters.q && <ActiveChip label={`“${filters.q}”`} onRemove={() => update({ q: undefined })} />}
          {filters.near && (
            <ActiveChip
              label={
                <>
                  <MapPin className="size-3.5 text-paprika" aria-hidden />
                  {filters.near}
                </>
              }
              onRemove={() => update(placeReset())}
            />
          )}
          {filters.vibe.map((v) => (
            <ActiveChip key={v} label={VIBE_LABELS[v]} onRemove={() => update({ vibe: filters.vibe.filter((x) => x !== v) })} />
          ))}
          {filters.maybe && <ActiveChip label="Unconfirmed" onRemove={() => update({ maybe: undefined })} />}
          <li>
            <button
              type="button"
              onClick={() => update({ ...SEARCH_RESET, ...placeReset(), maybe: undefined })}
              className="inline-flex h-9 cursor-pointer items-center px-1 text-sm font-semibold text-ink-soft underline underline-offset-4 hover:text-ink"
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
      <legend className="mb-3 text-sm font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} onClick={() => onToggle(o.value)} className={cn(pill, on ? pillOn : pillOff)}>
              {on && <Check className="size-4" aria-hidden />}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ActiveChip({ label, onRemove }: { label: React.ReactNode; onRemove: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md bg-secondary pr-2 pl-3 text-sm font-medium transition-colors hover:bg-accent"
      >
        {label}
        <X className="size-3.5" aria-hidden />
        <span className="sr-only">Remove filter</span>
      </button>
    </li>
  );
}
