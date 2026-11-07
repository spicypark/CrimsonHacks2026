import { Suspense } from "react";
import { parseFilters } from "@/lib/events/filters";
import { queryEvents } from "@/lib/events/query";

// Scaffold placeholder — the real list UI (cards, filter bar, NL search) is built next
// with the ui-ux-pro-max / frontend-design skills.

export default function Home(props: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">PullUp</h1>
      <p className="text-muted-foreground mt-1">Open-invite events along the Wasatch Front.</p>
      <Suspense fallback={<p className="mt-8 text-sm">Loading events…</p>}>
        <EventList searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function EventList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const events = queryEvents(parseFilters(await searchParams));
  if (!events.length) return <p className="mt-8 text-sm">No events yet — run <code>npm run pipeline</code>.</p>;
  return (
    <ul className="mt-8 divide-y">
      {events.map((e) => (
        <li key={e.id} className="py-3">
          <a href={`/events/${e.id}`} className="font-medium hover:underline">
            {e.title}
          </a>
          <div className="text-muted-foreground text-sm">
            {new Date(e.startsAt).toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" })}
            {e.venueName ? ` · ${e.venueName}` : ""} · seen on {e.sources.length} source(s)
          </div>
        </li>
      ))}
    </ul>
  );
}
