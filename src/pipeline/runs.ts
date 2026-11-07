import { desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

/** Queues a pipeline run; the worker process picks it up within a few seconds. */
export function requestRun(): number {
  return getDb().insert(schema.pipelineRuns).values({ status: "requested" }).returning().get().id;
}

export function latestRun() {
  return getDb().select().from(schema.pipelineRuns).orderBy(desc(schema.pipelineRuns.id)).get() ?? null;
}
