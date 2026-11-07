import { isAdmin } from "@/lib/admin";
import { importSnapshot, SnapshotError } from "@/lib/db/snapshot";

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * POST /api/admin/import — replaces this deployment's event data with an uploaded snapshot
 * (made locally with `npm run snapshot`). Auth: `x-admin-secret` header (kept out of URLs and logs).
 *
 *   curl -X POST -H "x-admin-secret: $ADMIN_SECRET" -H "Content-Type: application/octet-stream" \
 *        --data-binary @data/pullup-snapshot.db https://<your-domain>/api/admin/import
 */
export async function POST(request: Request) {
  if (!isAdmin(request.headers.get("x-admin-secret"))) return new Response("Not found", { status: 404 });
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ error: "Snapshot is larger than 200 MB." }, { status: 413 });

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return Response.json({ error: "Snapshot is larger than 200 MB." }, { status: 413 });
  try {
    const counts = importSnapshot(bytes);
    return Response.json({ imported: counts });
  } catch (e) {
    const status = e instanceof SnapshotError ? 400 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
