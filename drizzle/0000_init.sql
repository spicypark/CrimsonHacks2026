CREATE TABLE `event_sources` (
	`event_id` text NOT NULL,
	`raw_item_id` integer NOT NULL,
	PRIMARY KEY(`event_id`, `raw_item_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_item_id`) REFERENCES `raw_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text,
	`vibe_tags` text DEFAULT '[]' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`ends_at_estimated` integer DEFAULT false NOT NULL,
	`venue_name` text,
	`address` text,
	`lat` real,
	`lng` real,
	`is_free` integer,
	`price_text` text,
	`image_url` text,
	`confidence` real DEFAULT 1 NOT NULL,
	`buzz_score` real,
	`status` text DEFAULT 'active' NOT NULL,
	`embedding` blob,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_starts_at` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `events_category` ON `events` (`category`);--> statement-breakpoint
CREATE TABLE `geocode_cache` (
	`query` text PRIMARY KEY NOT NULL,
	`lat` real,
	`lng` real,
	`display_name` text
);
--> statement-breakpoint
CREATE TABLE `pipeline_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer,
	`ts` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`stage` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`data` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pipeline_log_run` ON `pipeline_log` (`run_id`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	`stats` text
);
--> statement-breakpoint
CREATE TABLE `raw_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`url` text NOT NULL,
	`content_hash` text NOT NULL,
	`engagement` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`processed_hash` text,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_items_source_ext` ON `raw_items` (`source_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`event_ids` text NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`label` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_at` text,
	`last_error` text
);
