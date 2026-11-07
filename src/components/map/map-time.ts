import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";
import { TIME_ZONE } from "@/shared/time";

/** Slider resolution. */
export const STEP_MS = 5 * 60_000;
/** The map only ever covers the next 7 days (days 0–6, Utah time), so no window can exceed a week. */
export const LAST_DAY = 6;

export type RangeKey = "today" | "two" | "week" | "custom";
/** A window of whole Utah days, as offsets from today (0) to LAST_DAY inclusive. */
export interface Range {
  key: RangeKey;
  from: number;
  to: number;
}

/** Start of the Utah calendar day `offset` days from `now`, as epoch ms. */
export const dayStart = (now: number, offset: number) => addDays(startOfDay(new TZDate(now, TIME_ZONE)), offset).getTime();

/** The slider's [start, end] for a range. Today starts at the current quarter hour, not midnight. */
export function rangeWindow(range: Range, now: number): { start: number; end: number } {
  const start = range.from === 0 ? Math.floor(now / STEP_MS) * STEP_MS : dayStart(now, range.from);
  return { start, end: dayStart(now, range.to + 1) };
}
