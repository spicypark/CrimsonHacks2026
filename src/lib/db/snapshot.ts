import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dbPath, getDb } from "./client";

/**
 * Event data that moves between databases (local → live). Order is parent-first for inserts;
 * deletes run in reverse. Pipeline runs/logs and shares are per-deployment and never copied.
 */
export const SNAPSHOT_TABLES = ["sources", "raw_items", "events", "event_sources", "geocode_cache"] as const;

/** Writes a consistent, compact copy of the event data to `outFile` (safe while the app is running). */
export function writeSnapshot(outFile: string): Record<string, number> {
  fs.rmSync(outFile, { force: true });
  getDb().$client.prepare("VACUUM INTO ?").run(outFile);
  const snap = new Database(outFile);
  try {
    snap.exec("DELETE FROM pipeline_log; DELETE FROM pipeline_runs; DELETE FROM shares;");
    snap.exec("VACUUM");
    return countRows(snap, "main");
  } finally {
    snap.close();
  }
}

/**
 * Replaces the live event data with the contents of a snapshot file (written by `writeSnapshot`).
 * Runs in one transaction on the open connection, so the web app and the worker keep working.
 */
export function importSnapshot(snapshotBytes: Buffer): Record<string, number> {
  if (!snapshotBytes.subarray(0, 16).toString("latin1").startsWith("SQLite format 3")) {
    throw new SnapshotError("Upload is not a SQLite database file.");
  }
  const tmp = path.join(path.dirname(dbPath()), `import-${Date.now()}.db`);
  fs.writeFileSync(tmp, snapshotBytes);
  const sqlite = getDb().$client;
  sqlite.prepare("ATTACH DATABASE ? AS snap").run(tmp);
  try {
    const snapTables = new Set(
      (sqlite.prepare("SELECT name FROM snap.sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name),
    );
    const missing = SNAPSHOT_TABLES.filter((t) => !snapTables.has(t));
    if (missing.length) throw new SnapshotError(`Snapshot is missing tables: ${missing.join(", ")}`);

    sqlite.transaction(() => {
      for (const t of [...SNAPSHOT_TABLES].reverse()) sqlite.prepare(`DELETE FROM main.${t}`).run();
      for (const t of SNAPSHOT_TABLES) {
        // Explicit column list: tolerant of column-order differences between the two databases.
        const cols = (sqlite.prepare(`PRAGMA main.table_info(${t})`).all() as { name: string }[]).map((c) => `"${c.name}"`).join(", ");
        sqlite.prepare(`INSERT INTO main.${t} (${cols}) SELECT ${cols} FROM snap.${t}`).run();
      }
    })();
    return countRows(sqlite, "main");
  } finally {
    sqlite.prepare("DETACH DATABASE snap").run();
    fs.rmSync(tmp, { force: true });
  }
}

export class SnapshotError extends Error {}

function countRows(db: Database.Database, schemaName: string): Record<string, number> {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((t) => [t, (db.prepare(`SELECT count(*) AS n FROM ${schemaName}.${t}`).get() as { n: number }).n]),
  );
}
