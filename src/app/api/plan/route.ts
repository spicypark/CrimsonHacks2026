import { z } from "zod";
import { planNight } from "@/lib/plan/plan";

const Body = z.object({ text: z.string().trim().min(3).max(600) });

/**
 * POST /api/plan { text } → NightPlan
 * Turns a description of someone's night ("free live music after 7, then somewhere chill near downtown")
 * into an ordered itinerary of real events. Works without AI too (greedy schedule, `ai: false`).
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Describe your night in a few words." }, { status: 400 });
  try {
    return Response.json(await planNight(parsed.data.text));
  } catch (e) {
    console.error("[plan]", (e as Error).message.slice(0, 300));
    return Response.json({ error: "Couldn't build a plan right now. Try again in a moment." }, { status: 500 });
  }
}
