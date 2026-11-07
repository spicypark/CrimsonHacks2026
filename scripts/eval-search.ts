/**
 * Manual eval for AI search and Plan my night against the real DB and AI providers.
 *   npx tsx --env-file-if-exists=.env.local scripts/eval-search.ts [search|plan|all]
 */
import { FiltersSchema } from "@/lib/events/filters";
import { searchEvents } from "@/lib/search/relax";
import { understand } from "@/lib/search/understand";
import { planNight } from "@/lib/plan/plan";
import { formatTime } from "@/lib/events/format";

const SEARCHES = [
  "jazz tonight",
  "free things to do this weekend",
  "stand up comedy",
  "something to do with my kids saturday",
  "live music near sugar house",
  "board games",
  "hiking",
  "date night ideas",
  "concerts tomorrow",
  "art",
  "trivia",
  "basketball game",
  "chill bar tonight",
  "food",
  "events near me",
  "things to do in provo",
];

const PLANS = [
  "free live music after 7, then somewhere chill near downtown",
  "date night tonight, dinner then a show",
  "saturday afternoon with my kids",
  "I'm free from 6 to 10 tomorrow, want something social",
  "comedy and drinks tonight",
  "something outdoorsy this weekend morning",
];

async function runSearch(q: string) {
  const t0 = Date.now();
  let plan, ai = true;
  try { plan = await understand(q); } catch (e) { ai = false; plan = { filters: { q, ask: q }, nearMe: false }; console.log("  understand ERR", (e as Error).message.slice(0, 200)); }
  const f = FiltersSchema.parse({ ...plan.filters, cat: plan.filters.cat?.join(","), vibe: plan.filters.vibe?.join(",") });
  const { events, relaxed } = await searchEvents(f);
  const { ask: _a, ...shown } = plan.filters;
  console.log(`\n▶ "${q}"  (${Date.now() - t0} ms, ai=${ai}) → ${JSON.stringify(shown)} nearMe=${plan.nearMe}`);
  console.log(`  results=${events.length}${relaxed ? ` (relaxed: ${relaxed})` : ""}`);
  for (const e of events.slice(0, 6)) console.log(`   · ${e.title.slice(0, 70)} [${e.category}] ${formatTime(e.startsAt)}`);
}

async function runPlan(text: string) {
  const t0 = Date.now();
  const p = await planNight(text, process.env.NOW ? new Date(process.env.NOW) : undefined);
  console.log(`\n▶ PLAN "${text}" (${Date.now() - t0} ms, ai=${p.ai})`);
  console.log(`  window ${p.window.from} → ${p.window.to}; understood ${JSON.stringify(p.understood)}`);
  console.log(`  ${p.title} — ${p.summary}`);
  for (const s of p.stops) console.log(`   ${formatTime(s.arriveAt)}–${formatTime(s.leaveAt)} ${s.event.title.slice(0, 60)} [${s.event.category}] (event ${formatTime(s.event.startsAt)}–${formatTime(s.event.endsAt)}) ${s.travel ? `+${s.travel.minutes}min` : ""}${s.tight ? " TIGHT" : ""}\n      why: ${s.why.slice(0, 140)}`);
  console.log(`  backups: ${p.backups.map((b) => b.title.slice(0, 40)).join(" | ")}`);
}

const mode = process.argv[2] ?? "all";
const only = process.argv.slice(3);
(async () => {
  if (mode === "search" || mode === "all") for (const q of only.length ? only : SEARCHES) await runSearch(q);
  if (mode === "plan" || mode === "all") for (const t of only.length ? only : PLANS) await runPlan(t);
})();
