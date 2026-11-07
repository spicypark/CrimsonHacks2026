import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env, REGION } from "@/lib/env";

export interface Point {
  lat: number;
  lng: number;
}

let lastCall = 0;

/**
 * Free-text place → coordinates via OpenStreetMap Nominatim, restricted to the Wasatch Front.
 * Cached forever (including misses). Serialized to Nominatim's 1 request/second policy.
 */
export async function geocode(query: string): Promise<Point | null> {
  // Parentheticals ("Natural History Museum of Utah (NHMU)", "(Room 210)") confuse Nominatim.
  query = query.replace(/\([^)]*\)/g, " ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
  const key = query.toLowerCase();
  if (!key) return null;
  const db = getDb();
  const cached = db.select().from(schema.geocodeCache).where(eq(schema.geocodeCache.query, key)).get();
  if (cached) return cached.lat != null && cached.lng != null ? { lat: cached.lat, lng: cached.lng } : null;

  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const [w, s, e, n] = REGION.bbox;
  const params = new URLSearchParams({
    q: /utah|\bUT\b/i.test(query) ? query : `${query}, Utah`,
    format: "jsonv2",
    limit: "1",
    countrycodes: "us",
    viewbox: `${w},${n},${e},${s}`,
    bounded: "1",
  });
  let hit: { lat: string; lon: string; display_name: string } | undefined;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": env.userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) hit = ((await res.json()) as (typeof hit)[])[0];
    else return null; // don't cache transient failures
  } catch {
    return null;
  }

  const point = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  db.insert(schema.geocodeCache)
    .values({ query: key, lat: point?.lat ?? null, lng: point?.lng ?? null, displayName: hit?.display_name ?? null })
    .onConflictDoNothing()
    .run();
  return point;
}

export function inRegion(p: Point): boolean {
  const [w, s, e, n] = REGION.bbox;
  return p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;
}

/** Great-circle distance in meters. */
export function distanceM(a: Point, b: Point): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
