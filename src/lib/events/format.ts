import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, format } from "date-fns";
import type { Engagement, SourceType, VibeTag } from "@/shared/event";
import { TIME_ZONE } from "@/shared/time";

/** Pure display helpers shared by server and client components. All output is Utah local time. */

const local = (iso: string) => new TZDate(iso, TIME_ZONE);

/** Below this AI confidence an event goes to the "maybe" view instead of the main feed. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** "7:30 PM" / "7 PM" */
export function formatTime(iso: string): string {
  const d = local(iso);
  return format(d, d.getMinutes() ? "h:mm a" : "h a");
}

/** "7:30–10 PM", "11 AM–1 PM", or "7 PM, ends around 10 PM" when the end is estimated. */
export function formatTimeRange(startIso: string, endIso: string, endEstimated: boolean): string {
  const s = local(startIso);
  const e = local(endIso);
  const sameMeridiem = format(s, "a") === format(e, "a") && differenceInCalendarDays(e, s) === 0;
  const start = format(s, s.getMinutes() ? (sameMeridiem ? "h:mm" : "h:mm a") : sameMeridiem ? "h" : "h a");
  const end = formatTime(endIso);
  if (endEstimated) return `${formatTime(startIso)}, ends around ${end}`;
  return `${start}–${end}`;
}

/** "Fri, Nov 7" */
export const shortDate = (iso: string) => format(local(iso), "EEE, MMM d");

/** Calendar-day key in Utah time, for grouping. */
export const dayKey = (iso: string) => format(local(iso), "yyyy-MM-dd");

/** "Tonight", "Today", "Tomorrow", "Saturday", or "Sat, Nov 15" beyond a week. */
export function dayLabel(key: string, now = new Date()): string {
  const today = local(now.toISOString());
  const [y, m, d] = key.split("-").map(Number);
  const day = new TZDate(y, m - 1, d, 12, 0, 0, TIME_ZONE);
  const diff = differenceInCalendarDays(day, today);
  if (diff <= 0) return today.getHours() >= 16 ? "Tonight" : "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return format(day, "EEEE");
  return format(day, "EEE, MMM d");
}

/** "Nov 8" — shown under weekday labels so the date is never ambiguous. */
export function dayDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return format(new TZDate(y, m - 1, d, 12, 0, 0, TIME_ZONE), "MMM d");
}

export const isLive = (startIso: string, endIso: string, now = Date.now()) =>
  new Date(startIso).getTime() <= now && now < new Date(endIso).getTime();

export const SOURCE_LABELS: Record<SourceType, string> = {
  reddit: "Reddit",
  ticketmaster: "Ticketmaster",
  seatgeek: "SeatGeek",
  ical: "Calendar",
  webpage: "Web",
};

export const VIBE_LABELS: Record<VibeTag, string> = {
  free: "Free",
  "beginner-friendly": "Beginner-friendly",
  "meet-people": "Meet people",
  "go-solo": "Go solo",
  "family-friendly": "Family-friendly",
  "21-plus": "21+",
  "dog-friendly": "Dog-friendly",
  outdoorsy: "Outdoorsy",
  chill: "Chill",
  "high-energy": "High energy",
  student: "Student",
};

/** Compact count: 1234 → "1.2k". */
export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Sum engagement across sources for the card's traction line. Undefined fields stay undefined. */
export function totalEngagement(list: Engagement[]): { upvotes?: number; comments?: number } {
  const sum = (k: "upvotes" | "comments") =>
    list.some((e) => e[k] != null) ? list.reduce((a, e) => a + (e[k] ?? 0), 0) : undefined;
  return { upvotes: sum("upvotes"), comments: sum("comments") };
}

export function priceLabel(isFree: boolean | null, priceText: string | null): string | null {
  if (isFree) return "Free";
  if (priceText) return priceText;
  if (isFree === false) return "Paid";
  return null;
}
