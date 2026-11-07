import { asc, desc, gt } from "drizzle-orm";
import { isAdmin } from "@/lib/admin";
import { getDb, schema } from "@/lib/db/client";
import { latestRun } from "@/pipeline/runs";

const POLL_MS = 750;
const BACKLOG = 200;

/**
 * GET /api/admin/stream?secret=… — Server-Sent Events feed of pipeline_log rows plus the current run status.
 * Events: `log` (one row), `run` (latest pipeline_runs row whenever it changes).
 */
export async function GET(request: Request) {
  if (!isAdmin(new URL(request.url).searchParams.get("secret"))) return new Response("Not found", { status: 404 });

  const db = getDb();
  const log = schema.pipelineLog;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      // Backlog: the most recent rows, oldest first.
      const backlog = db.select().from(log).orderBy(desc(log.id)).limit(BACKLOG).all().reverse();
      backlog.forEach((row) => send("log", row));
      let lastId = backlog.at(-1)?.id ?? 0;
      let lastRunJson = "";

      const tick = () => {
        for (const row of db.select().from(log).where(gt(log.id, lastId)).orderBy(asc(log.id)).limit(500).all()) {
          send("log", row);
          lastId = row.id;
        }
        const run = latestRun();
        const json = JSON.stringify(run);
        if (json !== lastRunJson) {
          lastRunJson = json;
          send("run", run);
        }
      };
      tick();
      timer = setInterval(() => {
        try {
          tick();
        } catch {
          clearInterval(timer);
          controller.close();
        }
      }, POLL_MS);
      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        controller.close();
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
