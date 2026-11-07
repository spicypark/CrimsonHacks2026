import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

// One connection per process; survives Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __pullupDb?: Db };

function open(): Db {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "pullup.db");
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
