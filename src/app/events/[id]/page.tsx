import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getEvent } from "@/lib/events/query";

// Scaffold placeholder — full detail page (hero, mini-map, summary, sources) comes in the UI phase.

export default function EventPage(props: PageProps<"/events/[id]">) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Suspense fallback={<p className="text-sm">Loading…</p>}>
        <Detail params={props.params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: PageProps<"/events/[id]">["params"] }) {
  const { id } = await params;
  const e = getEvent(id);
  if (!e) notFound();
  return (
    <article>
      <h1 className="text-2xl font-semibold">{e.title}</h1>
      <p className="mt-2">{e.summary}</p>
      <ul className="mt-6 text-sm">
        {e.sources.map((s) => (
          <li key={s.url}>
            <a className="underline" href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}
