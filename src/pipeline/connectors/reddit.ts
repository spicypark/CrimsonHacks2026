import { env } from "@/lib/env";
import type { RawItem } from "@/shared/event";
import * as cheerio from "cheerio";
import { getJson, getText } from "./http";
import type { Connector } from "./types";

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  permalink: string;
  url: string;
  score: number;
  num_comments: number;
  created_utc: number;
  over_18: boolean;
  link_flair_text?: string | null;
  preview?: { images?: { source: { url: string } }[] };
}

const MAX_AGE_DAYS = 14;

/** Cheap pre-filter so we only spend LLM calls on posts that plausibly announce an event. */
const EVENT_HINT =
  /\b(event|meetup|meet-up|tonight|this (week|weekend|friday|saturday|sunday)|tomorrow|free|show|concert|market|festival|run club|join us|open mic|trivia|potluck|hike|workshop|class|party|fair|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}\/\d{1,2})\b/i;

let token: { value: string; expiresAt: number } | null = null;

/** App-only OAuth token if credentials exist; null means use the public JSON endpoints. */
async function getToken(): Promise<string | null> {
  if (!env.redditClientId || !env.redditClientSecret) return null;
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.redditClientId}:${env.redditClientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": env.userAgent,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null; // fall back to public endpoints rather than failing the source
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export const reddit: Connector = {
  type: "reddit",
  /** source.target = subreddit name without "r/" */
  async fetch(source) {
    const sub = source.target.replace(/^\/?r\//, "");
    const auth = await getToken();
    // Unauthenticated JSON is blocked (403); the public Atom feed still works but carries no vote counts.
    if (!auth) return fromAtom(sub);
    const data = await getJson<{ data: { children: { data: RedditPost }[] } }>(
      `https://oauth.reddit.com/r/${sub}/new?limit=100&raw_json=1`,
      { headers: { Authorization: `Bearer ${auth}` } },
    );

    const cutoff = Date.now() / 1000 - MAX_AGE_DAYS * 86400;
    return data.data.children
      .map((c) => c.data)
      .filter((p) => !p.over_18 && p.created_utc >= cutoff)
      .filter((p) => /event/i.test(p.link_flair_text ?? "") || EVENT_HINT.test(`${p.title}\n${p.selftext}`))
      .map(
        (p): RawItem => ({
          externalId: p.id,
          url: `https://www.reddit.com${p.permalink}`,
          text: [
            `Subreddit: r/${sub}`,
            `Posted: ${new Date(p.created_utc * 1000).toISOString()}`,
            `Title: ${p.title}`,
            p.selftext,
            p.url && !p.url.includes(p.permalink) ? `Link: ${p.url}` : "",
            p.preview?.images?.[0] ? `Image: ${p.preview.images[0].source.url}` : "",
          ]
            .filter(Boolean)
            .join("\n")
            .slice(0, 6000),
          event: null,
          engagement: { upvotes: p.score, comments: p.num_comments },
          postedAt: new Date(p.created_utc * 1000).toISOString(),
        }),
      );
  },
};

/** Reddit rate-limits anonymous feed reads hard; keep consecutive subreddit fetches well apart. */
const RSS_GAP_MS = 8_000;
let lastRss = 0;

async function fromAtom(sub: string): Promise<RawItem[]> {
  const wait = lastRss + RSS_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRss = Date.now();
  const $ = cheerio.load(await getText(`https://www.reddit.com/r/${sub}/new/.rss?limit=100`), { xml: true });
  const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
  return $("entry")
    .toArray()
    .map((el) => {
      const node = $(el);
      const title = node.find("title").first().text().trim();
      const body = cheerio.load(node.find("content").first().text()).text().replace(/\s+/g, " ").trim();
      const posted = node.find("published, updated").first().text().trim();
      return {
        externalId: node.find("id").first().text().trim().replace(/^t3_/, ""),
        url: node.find("link").first().attr("href") ?? "",
        title,
        body,
        posted,
      };
    })
    .filter((p) => p.url && new Date(p.posted).getTime() >= cutoff && EVENT_HINT.test(`${p.title}\n${p.body}`))
    .map(
      (p): RawItem => ({
        externalId: p.externalId,
        url: p.url,
        text: `Subreddit: r/${sub}\nPosted: ${p.posted}\nTitle: ${p.title}\n${p.body}`.slice(0, 6000),
        event: null,
        engagement: {},
        postedAt: p.posted || null,
      }),
    );
}
