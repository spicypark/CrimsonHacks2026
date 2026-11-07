import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { Category, Engagement, SourceType, VibeTag } from "@/shared/event";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").$type<SourceType>().notNull(),
  /** URL for feeds/pages, subreddit name for reddit, unused for API sources. */
  target: text("target").notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastCheckedAt: text("last_checked_at"),
  lastError: text("last_error"),
});

export const rawItems = sqliteTable(
  "raw_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    contentHash: text("content_hash").notNull(),
    engagement: text("engagement", { mode: "json" }).$type<Engagement>().notNull(),
    fetchedAt: text("fetched_at").notNull().default(now),
    /** Set once this item has been turned into (or rejected as) an event. */
    processedHash: text("processed_hash"),
  },
  (t) => [uniqueIndex("raw_items_source_ext").on(t.sourceId, t.externalId)],
);

export type EventStatus = "active" | "cancelled" | "changed";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(), // nanoid
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    category: text("category").$type<Category>(),
    vibeTags: text("vibe_tags", { mode: "json" }).$type<VibeTag[]>().notNull().default([]),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    endsAtEstimated: integer("ends_at_estimated", { mode: "boolean" }).notNull().default(false),
    venueName: text("venue_name"),
    address: text("address"),
    lat: real("lat"),
    lng: real("lng"),
    isFree: integer("is_free", { mode: "boolean" }),
    priceText: text("price_text"),
    imageUrl: text("image_url"),
    confidence: real("confidence").notNull().default(1),
    buzzScore: real("buzz_score"),
    status: text("status").$type<EventStatus>().notNull().default("active"),
    embedding: blob("embedding", { mode: "buffer" }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [index("events_starts_at").on(t.startsAt), index("events_category").on(t.category)],
);

export const eventSources = sqliteTable(
  "event_sources",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    rawItemId: integer("raw_item_id")
      .notNull()
      .references(() => rawItems.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.rawItemId] })],
);

export const geocodeCache = sqliteTable("geocode_cache", {
  query: text("query").primaryKey(),
  lat: real("lat"),
  lng: real("lng"),
  displayName: text("display_name"),
});

export type RunStatus = "requested" | "running" | "done" | "failed";

export const pipelineRuns = sqliteTable("pipeline_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").$type<RunStatus>().notNull(),
  requestedAt: text("requested_at").notNull().default(now),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  stats: text("stats", { mode: "json" }).$type<Record<string, number>>(),
});

export type LogStage = "discover" | "fetch" | "extract" | "geocode" | "merge" | "run";

export const pipelineLog = sqliteTable(
  "pipeline_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id").references(() => pipelineRuns.id),
    ts: text("ts").notNull().default(now),
    stage: text("stage").$type<LogStage>().notNull(),
    level: text("level").$type<"info" | "warn" | "error">().notNull().default("info"),
    message: text("message").notNull(),
    data: text("data", { mode: "json" }),
  },
  (t) => [index("pipeline_log_run").on(t.runId)],
);

export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  eventIds: text("event_ids", { mode: "json" }).$type<string[]>().notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(now),
});
