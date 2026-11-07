import { z } from "zod";
import { understand } from "@/lib/search/understand";

const Body = z.object({ q: z.string().trim().min(1).max(200) });

/**
 * POST /api/search { q } → { filters, nearMe, ai }
 * Turns a natural-language search into list filters. If the AI is unavailable the search still works:
 * the text comes back as plain search words (`ai: false`).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { q: string }" }, { status: 400 });
  const { q } = parsed.data;
  try {
    return Response.json({ ...(await understand(q)), ai: true });
  } catch (e) {
    console.error("[search]", (e as Error).message.slice(0, 300));
    return Response.json({ filters: { ask: q, q }, nearMe: false, ai: false });
  }
}
