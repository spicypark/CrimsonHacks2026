import { parseFilters } from "@/lib/events/filters";
import { queryEvents } from "@/lib/events/query";

/** GET /api/events?when=&cat=&vibe=&free=&sort=&lat=&lng=&maybe= — same params as the list/map URLs. */
export async function GET(request: Request) {
  const filters = parseFilters(new URL(request.url).searchParams);
  return Response.json({ filters, events: queryEvents(filters) });
}
