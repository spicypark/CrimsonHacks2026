/**
 * Long-running pipeline worker (runs beside `next start`).
 * - Picks up runs requested from the admin page ("Run now") every few seconds.
 * - Schedules a full run every SCHEDULE_HOURS.
 *
 * `npm run pipeline` runs once and exits instead.
 */
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { runPipeline } from "./run";
import { latestRun, requestRun } from "./runs";

const POLL_MS = 3_000;
const SCHEDULE_HOURS = 3;

async function execute(runId: number, sourceIds?: number[]) {
  const db = getDb();
  db.update(schema.pipelineRuns)
    .set({ status: "running", startedAt: new Date().toISOString() })
    .where(eq(schema.pipelineRuns.id, runId))
    .run();
  try {
    const stats = await runPipeline({ runId, sourceIds });
    db.update(schema.pipelineRuns)
      .set({ status: "done", finishedAt: new Date().toISOString(), stats: { ...stats } })
      .where(eq(schema.pipelineRuns.id, runId))
      .run();
  } catch (e) {
    console.error(e);
    db.update(schema.pipelineRuns)
      .set({ status: "failed", finishedAt: new Date().toISOString() })
      .where(eq(schema.pipelineRuns.id, runId))
      .run();
  }
}

async function loop() {
  const db = getDb();
  // A crash mid-run leaves rows "running"; mark them failed on boot.
  db.update(schema.pipelineRuns).set({ status: "failed" }).where(eq(schema.pipelineRuns.status, "running")).run();
  console.log("[worker] started");

  for (;;) {
    const next = db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.status, "requested"))
      .orderBy(asc(schema.pipelineRuns.id))
      .get();
    if (next) {
      await execute(next.id);
      continue;
    }
    const last = latestRun();
    const lastAt = last ? new Date(last.requestedAt).getTime() : 0;
    if (Date.now() - lastAt > SCHEDULE_HOURS * 3600e3) requestRun();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

if (process.argv.includes("--once")) {
  execute(requestRun()).then(() => process.exit(0));
} else {
  void loop();
}
