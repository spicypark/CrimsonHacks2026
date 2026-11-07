import { TZDate } from "@date-fns/tz";
import { addDays, endOfDay, nextSaturday, isSaturday, isSunday, startOfDay } from "date-fns";
import { z } from "zod";
import { Category, VibeTag } from "@/shared/event";
import { TIME_ZONE } from "@/shared/time";

/**
 * All list/map filter state, serialized in URL search params so the list, the map and
 * shared links stay in sync. Parse with `parseFilters`, write with `filtersToParams`.
 */
export const WHEN = ["now", "today", "tonight", "tomorrow", "weekend", "week", "month"] as const;
export const SORTS = ["soon", "popular", "near", "new"] as const;

/** Comma-separated list param; unknown values are dropped rather than failing the whole parse. */
const csv = <T extends string>(item: z.ZodType<T>) =>
  z
    .string()
    .optional()
    .catch(undefined)
    .transform((s) => (s ? s.split(",") : []).filter((x): x is T => item.safeParse(x).success));

export const FiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  when: z.enum(WHEN).catch("week").default("week"),
  cat: csv(Category),
  vibe: csv(VibeTag),
  free: z.enum(["1"]).optional().catch(undefined),
  sort: z.enum(SORTS).catch("soon").default("soon"),
  lat: z.coerce.number().min(-90).max(90).optional().catch(undefined),
  lng: z.coerce.number().min(-180).max(180).optional().catch(undefined),
  maybe: z.enum(["1"]).optional().catch(undefined),
});
export type Filters = z.infer<typeof FiltersSchema>;

type ParamsLike = URLSearchParams | Record<string, string | string[] | undefined>;

export function parseFilters(params: ParamsLike): Filters {
  const obj: Record<string, string> = {};
  if (params instanceof URLSearchParams) params.forEach((v, k) => (obj[k] = v));
  else for (const [k, v] of Object.entries(params)) if (v != null) obj[k] = Array.isArray(v) ? v.join(",") : v;
  return FiltersSchema.parse(obj);
}

export function filtersToParams(f: Partial<Filters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.when && f.when !== "week") p.set("when", f.when);
  if (f.cat?.length) p.set("cat", f.cat.join(","));
  if (f.vibe?.length) p.set("vibe", f.vibe.join(","));
  if (f.free) p.set("free", "1");
  if (f.sort && f.sort !== "soon") p.set("sort", f.sort);
  if (f.lat != null && f.lng != null) {
    p.set("lat", f.lat.toFixed(4));
    p.set("lng", f.lng.toFixed(4));
  }
  if (f.maybe) p.set("maybe", "1");
  return p;
}

/**
 * Resolves a `when` preset to an [from, to) window in Utah time. Events overlapping the window match.
 * Returns plain UTC Dates: TZDate#toISOString keeps a "-07:00" offset, which breaks the DB's lexical
 * comparison against stored "...Z" timestamps.
 */
export function timeWindow(when: Filters["when"], now = new Date()): { from: Date; to: Date } {
  const { from, to } = localWindow(when, now);
  return { from: new Date(from.getTime()), to: new Date(to.getTime()) };
}

function localWindow(when: Filters["when"], now: Date): { from: Date; to: Date } {
  const local = new TZDate(now, TIME_ZONE);
  const day = startOfDay(local);
  switch (when) {
    case "now":
      return { from: now, to: new Date(now.getTime() + 60_000) };
    case "today":
      return { from: now, to: endOfDay(local) };
    case "tonight": {
      const five = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 17, 0, 0, TIME_ZONE);
      return { from: now > five ? now : five, to: endOfDay(local) };
    }
    case "tomorrow":
      return { from: addDays(day, 1), to: endOfDay(addDays(day, 1)) };
    case "weekend": {
      const sat = isSaturday(local) || isSunday(local) ? local : startOfDay(nextSaturday(local));
      const sun = isSunday(local) ? local : addDays(startOfDay(sat), 1);
      // Weekend starts Friday 5 PM if it's not already the weekend.
      const fri = addDays(startOfDay(sat), -1);
      const start = isSaturday(local) || isSunday(local) ? now : new TZDate(fri.getFullYear(), fri.getMonth(), fri.getDate(), 17, 0, 0, TIME_ZONE);
      return { from: start > now ? start : now, to: endOfDay(sun) };
    }
    case "month":
      return { from: now, to: addDays(day, 30) };
    case "week":
    default:
      return { from: now, to: addDays(day, 7) };
  }
}
