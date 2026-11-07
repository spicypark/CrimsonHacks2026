import { getDb, schema } from "@/lib/db/client";
import type { LogStage } from "@/lib/db/schema";

/** Writes a pipeline_log row (streamed live to the admin page) and mirrors it to stdout. */
export function createLogger(runId: number | null) {
  const write = (level: "info" | "warn" | "error") => (stage: LogStage, message: string, data?: unknown) => {
    const line = `[${stage}] ${message}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    getDb().insert(schema.pipelineLog).values({ runId, stage, level, message, data: data ?? null }).run();
  };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}

export type Logger = ReturnType<typeof createLogger>;
