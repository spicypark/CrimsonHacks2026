import { env } from "@/lib/env";

/** fetch with timeout, identifying User-Agent, and a useful error on non-2xx. */
export async function httpGet(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": env.userAgent, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GET ${new URL(url).host}${new URL(url).pathname} → ${res.status}`);
  return res;
}

export const getJson = async <T>(url: string, init?: RequestInit): Promise<T> =>
  (await httpGet(url, init)).json() as Promise<T>;

export const getText = async (url: string, init?: RequestInit): Promise<string> =>
  (await httpGet(url, init)).text();

/** ISO "YYYY-MM-DDTHH:mm:ssZ" without milliseconds (Ticketmaster rejects ms). */
export const isoNoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
