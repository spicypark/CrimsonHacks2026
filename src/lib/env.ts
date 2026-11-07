/** Typed access to environment configuration. Optional keys return undefined; required ones throw with a clear message. */

const optional = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

export function requireEnv(name: string): string {
  const v = optional(name);
  if (!v) throw new Error(`Missing env var ${name} — see SETUP.md`);
  return v;
}

export const env = {
  get ticketmasterKey() { return optional("TICKETMASTER_API_KEY"); },
  get seatgeekClientId() { return optional("SEATGEEK_CLIENT_ID"); },
  get redditClientId() { return optional("REDDIT_CLIENT_ID"); },
  get redditClientSecret() { return optional("REDDIT_CLIENT_SECRET"); },
  get redditUsername() { return optional("REDDIT_USERNAME") ?? "pullup-app"; },
  get adminSecret() { return optional("ADMIN_SECRET"); },
  get appUrl() { return optional("APP_URL") ?? "http://localhost:3000"; },
  /** Identifying User-Agent required by Nominatim and Reddit. */
  get userAgent() { return `web:pullup:v0.1 (+${this.appUrl}; by /u/${this.redditUsername})`; },
};

/** Wasatch Front geography used by connectors, geocoding and the map. */
export const REGION = {
  center: { lat: 40.7608, lng: -111.891 }, // downtown SLC
  radiusMiles: 60,
  /** west, south, east, north — Ogden to Provo */
  bbox: [-112.3, 40.0, -111.4, 41.35] as const,
  timeZone: "America/Denver",
};
