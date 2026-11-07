import { TZDate } from "@date-fns/tz";

export const TIME_ZONE = "America/Denver";

/** "2026-11-08" + "19:30[:00]" in Utah local time → ISO-8601 UTC string. DST-correct. */
export function utahLocalToIso(localDate: string, localTime = "19:00:00"): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const [hh, mm = 0, ss = 0] = localTime.split(":").map(Number);
  return new TZDate(y, m - 1, d, hh, mm, ss, TIME_ZONE).toISOString();
}

/** Parse anything date-like into ISO UTC, or null if unparseable. Strings without an offset are treated as Utah local. */
export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const local = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/);
  if (local) return utahLocalToIso(local[1], local[2] ?? "00:00:00");
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
