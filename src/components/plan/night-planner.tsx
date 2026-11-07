"use client";

import { AlertTriangle, CalendarDays, Car, Clock, Loader2, MapPin, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { EventCard } from "@/components/events/event-card";
import { EventThumb } from "@/components/events/event-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime, formatTimeRange, priceLabel, shortDate } from "@/lib/events/format";
import type { NightPlan, PlanStop } from "@/lib/plan/plan";
import { CATEGORY_LABELS } from "@/shared/event";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  "Free live music tonight after 7, then somewhere chill. I'm downtown SLC.",
  "Saturday night date: a show and something fun after, done by midnight.",
  "Sunday afternoon with my kids, 12 to 5, nothing too expensive.",
  "Solo tomorrow night, want to meet people. Free from 6 to 10.",
];

/** Timeline rows: time | rail (number + line) | card. */
const TIMELINE = "grid grid-cols-[4.5rem_1.5rem_1fr] gap-x-2 sm:grid-cols-[5.75rem_1.5rem_1fr] sm:gap-x-3";

const LOADING_STEPS =["Reading your night…", "Checking what's on…", "Lining up the stops…"];

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; plan: NightPlan; at: number };

/** Free-text "describe your night" → an ordered plan of real events, with swaps. The text is kept in ?q= so plans can be shared. */
export function NightPlanner({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<State>({ kind: "idle" });
  const ran = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const run = useCallback(async (value: string) => {
    const t = value.trim();
    if (t.length < 3) return;
    setState({ kind: "loading" });
    const url = new URL(window.location.href);
    url.searchParams.set("q", t);
    window.history.replaceState(null, "", url);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Something went wrong.");
      setState({ kind: "done", plan: body as NightPlan, at: Date.now() });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message || "Something went wrong." });
    }
  }, []);

  // A shared link (?q=…) plans straight away.
  useEffect(() => {
    if (initial && !ran.current) {
      ran.current = true;
      run(initial);
    }
  }, [initial, run]);

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    run(text);
  };

  const loading = state.kind === "loading";

  return (
    <div className="space-y-10">
      <section aria-labelledby="plan-heading" className="space-y-5">
        <div className="space-y-2">
          <h1 id="plan-heading" className="text-4xl font-bold tracking-tight sm:text-5xl">
            Plan my night<span className="text-paprika">.</span>
          </h1>
          <p className="text-base text-muted-foreground sm:text-lg">
            Say what you&apos;re in the mood for and when you&apos;re free. We&apos;ll line up real events that fit.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label htmlFor="night" className="sr-only">
            Describe your night
          </label>
          <div className="rounded-lg border border-border bg-card transition-colors focus-within:border-ink-soft">
            <textarea
              id="night"
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  run(text);
                }
              }}
              maxLength={600}
              rows={3}
              placeholder="e.g. Friday after work, free from 6 to 11. Want food and live music, nothing over $30, near Sugar House."
              className="block min-h-28 w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none placeholder:text-muted-foreground [field-sizing:content]"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter to plan</span>
              <button
                type="submit"
                disabled={loading || text.trim().length < 3}
                className="ml-auto inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-paprika px-5 text-sm font-bold text-carbon transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {loading ? "Planning…" : "Plan it"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setText(ex);
                  run(ex);
                }}
                disabled={loading}
                className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-200 hover:border-ink-soft hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>
      </section>

      <section aria-live="polite" aria-busy={loading}>
        {state.kind === "loading" && <PlanSkeleton />}
        {state.kind === "error" && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/50 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div className="space-y-2">
              <p className="font-semibold">{state.message}</p>
              <button type="button" onClick={() => run(text)} className="cursor-pointer text-sm font-semibold underline underline-offset-4">
                Try again
              </button>
            </div>
          </div>
        )}
        {state.kind === "done" && (
          <PlanView
            plan={state.plan}
            now={state.at}
            onReplan={() => {
              inputRef.current?.focus();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </section>
    </div>
  );
}

function PlanView({ plan, now, onReplan }: { plan: NightPlan; now: number; onReplan: () => void }) {
  const windowLabel = `${shortDate(plan.window.from)} · ${formatTime(plan.window.from)}–${formatTime(plan.window.to)}`;

  return (
    <div className="space-y-10">
      <header className="space-y-3 border-b-2 border-ink pb-5">
        <h2 className="text-3xl font-bold tracking-tight">{plan.title}</h2>
        <p className="text-base text-muted-foreground">{plan.summary}</p>
        <ul className="flex flex-wrap gap-1.5 pt-1 text-xs font-semibold" aria-label="What we understood">
          <li className="inline-flex items-center gap-1.5 rounded bg-secondary px-2 py-1 tabular-nums">
            <CalendarDays className="size-3.5 text-paprika" aria-hidden />
            {windowLabel}
          </li>
          {plan.understood.interests.map((i) => (
            <li key={i} className="rounded border border-border px-2 py-1 text-muted-foreground">
              {i}
            </li>
          ))}
          {plan.understood.freeOnly && <li className="rounded bg-carbon px-2 py-1 text-paprika uppercase">Free</li>}
          {plan.understood.place && (
            <li className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden />
              {plan.understood.place}
            </li>
          )}
          {!plan.ai && <li className="rounded border border-border px-2 py-1 text-muted-foreground">Quick pick (AI unavailable)</li>}
        </ul>
      </header>

      {plan.stops.length > 0 ? (
        <ol>
          {plan.stops.map((s, i) => (
            <li key={s.event.id}>
              {i > 0 && <TravelLeg stop={s} />}
              <Stop stop={s} index={i} last={i === plan.stops.length - 1} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="py-10 text-center">
          <p className="text-lg font-bold">No stops to suggest.</p>
          <p className="mt-1 text-muted-foreground">Try a different night or a wider time window.</p>
        </div>
      )}

      {plan.backups.length > 0 && (
        <section aria-labelledby="swaps" className="space-y-4">
          <h3 id="swaps" className="text-xl font-bold tracking-tight">
            Swap options
          </h3>
          <ol className="grid gap-4 sm:grid-cols-2">
            {plan.backups.map((e) => (
              <li key={e.id}>
                <EventCard event={e} now={now} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onReplan}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-5 text-sm font-semibold transition-colors duration-200 hover:border-ink-soft"
        >
          <RotateCcw className="size-4" aria-hidden />
          Tweak and replan
        </button>
      </div>
    </div>
  );
}

function Stop({ stop: s, index, last }: { stop: PlanStop; index: number; last: boolean }) {
  const e = s.event;
  const price = priceLabel(e.isFree, e.priceText);
  return (
    <div className={TIMELINE}>
      <div className="flex flex-col items-end pt-0.5 text-right">
        <span className="text-base leading-none font-bold whitespace-nowrap tabular-nums sm:text-xl">{formatTime(s.arriveAt)}</span>
        <span className="mt-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">to {formatTime(s.leaveAt)}</span>
      </div>

      <div aria-hidden className="flex flex-col items-center">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-paprika text-xs font-bold text-carbon">{index + 1}</span>
        {!last && <span className="mt-1 w-0.5 flex-1 bg-border" />}
      </div>

      <article className="group relative flex gap-4 overflow-hidden rounded-lg border border-border bg-card p-3 transition-[border-color,box-shadow] duration-200 hover:border-ink-soft hover:shadow-[0_6px_20px_-8px_rgb(37_36_34/0.35)] sm:p-4">
        <EventThumb src={e.imageUrl} category={e.category} className="hidden aspect-square w-28 shrink-0 rounded-md sm:block" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-lg leading-snug font-bold tracking-tight">
            <Link
              href={`/events/${e.id}`}
              className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {e.title}
            </Link>
          </h3>
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2 font-medium tabular-nums">
              <Clock className="size-4 shrink-0 text-paprika" aria-hidden />
              {formatTimeRange(e.startsAt, e.endsAt, e.endsAtEstimated)}
            </p>
            {(e.venueName || e.address) && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="size-4 shrink-0 text-paprika" aria-hidden />
                <span className="truncate">{e.venueName ?? e.address}</span>
              </p>
            )}
          </div>
          <p className="text-sm leading-relaxed">{s.why}</p>
          <ul className="flex flex-wrap gap-1.5 pt-0.5 text-xs font-semibold">
            {price && (
              <li className={cn("rounded px-2 py-0.5", e.isFree ? "bg-carbon text-paprika uppercase" : "bg-secondary")}>{price}</li>
            )}
            {e.category && <li className="rounded bg-secondary px-2 py-0.5">{CATEGORY_LABELS[e.category]}</li>}
          </ul>
        </div>
      </article>
    </div>
  );
}

/** The connector between two stops: the rail line continues, with the drive estimate beside it. */
function TravelLeg({ stop: s }: { stop: PlanStop }) {
  const t = s.travel;
  const miles = t ? t.km * 0.621 : null;
  return (
    <div className={TIMELINE}>
      <span />
      <span aria-hidden className="mx-auto w-0.5 bg-border" />
      <p className={cn("flex items-center gap-2 py-3 text-sm", s.tight ? "font-semibold text-paprika" : "text-muted-foreground")}>
        {s.tight ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <Car className="size-4 shrink-0" aria-hidden />}
        {t == null || miles == null ? "Next stop" : miles < 0.2 ? "Same spot" : `~${t.minutes} min drive · ${miles.toFixed(1)} mi`}
        {s.tight && " · tight, you may arrive late"}
      </p>
    </div>
  );
}

function PlanSkeleton() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="space-y-6" aria-label="Planning your night">
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-paprika" aria-hidden />
        {LOADING_STEPS[step]}
      </p>
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-full" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={TIMELINE}>
          <Skeleton className="ml-auto h-6 w-14" />
          <Skeleton className="mx-auto size-6 rounded-full" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
