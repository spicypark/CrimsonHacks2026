import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

// One connection per process; survives Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __pullupDb?: Db };

/** Absolute path of the SQLite file. `||` not `??`: an empty DATABASE_PATH= must fall back too (SQLite treats "" as a throwaway temp DB). */
export function dbPath(): string {
  return path.resolve(process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), "data", "pullup.db"));
}

function open(): Db {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL"); // web app reads while the worker writes
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}

/** Lazily-opened, migrated database. Never call at module top level in Next.js routes. */
export function getDb(): Db {
  return (globalForDb.__pullupDb ??= open());
}

export { schema };
