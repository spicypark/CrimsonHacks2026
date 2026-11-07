import { isAdmin } from "@/lib/admin";
import { requestRun } from "@/pipeline/runs";

/** POST /api/admin/run?secret=… — queues a pipeline run for the worker. */
export async function POST(request: Request) {
  if (!isAdmin(new URL(request.url).searchParams.get("secret"))) return new Response("Not found", { status: 404 });
  return Response.json({ runId: requestRun() });
}
