"use client";

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TIME_ZONE } from "@/shared/time";
import type { PlacedEvent } from "./live-map";
import { LAST_DAY, type Range, type RangeKey, STEP_MS, dayStart } from "./map-time";

const PRESETS: { key: Exclude<RangeKey, "custom">; label: string; short: string; from: number; to: number }[] = [
  { key: "today", label: "Today", short: "Today", from: 0, to: 0 },
  { key: "two", label: "Today & tomorrow", short: "2 days", from: 0, to: 1 },
  { key: "week", label: "This week", short: "Week", from: 0, to: LAST_DAY },
];

/** One full pass of the slider while playing, whatever the window length. */
const PLAY_DURATION_MS = 24_000;
const MAX_BINS = 168;

const local = (ms: number) => new TZDate(ms, TIME_ZONE);

export function TimeScrubber({
  now,
  start,
  end,
  time,
  onTime,
  range,
  onRange,
  events,
}: {
  now: number;
  start: number;
  end: number;
  time: number;
  onTime: (t: number) => void;
  range: Range;
  onRange: (r: Range) => void;
  events: PlacedEvent[];
}) {
  const span = end - start;
  const pct = span > 0 ? ((time - start) / span) * 100 : 0;
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(time);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  // Play: advance continuously, snap displayed value to the slider step, stop at the end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let t = timeRef.current >= end ? start : timeRef.current;
    const tick = (ts: number) => {
      t += ((ts - last) / PLAY_DURATION_MS) * span;
      last = ts;
      if (t >= end) {
        onTime(end);
        setPlaying(false);
        return;
      }
      onTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end, span, onTime]);

  const bins = useMemo(() => {
    const width = Math.max(STEP_MS, span / MAX_BINS);
    const n = Math.max(1, Math.ceil(span / width));
    const counts = Array.from({ length: n }, (_, i) => {
      const mid = start + (i + 0.5) * width;
      return events.reduce((c, e) => c + (e.start <= mid && mid < e.end ? 1 : 0), 0);
    });
    return { counts, max: Math.max(1, ...counts) };
  }, [events, start, span]);

  const ticks = useMemo(() => {
    // Hour labels only where they fit: every 3h within a day, every 6h across two, none for longer windows.
    const every = span <= 864e5 ? 3 : span <= 2 * 864e5 ? 6 : 0;
    const out: { at: number; pct: number; label: string; day: boolean }[] = [];
    for (let h = Math.ceil(start / 36e5) * 36e5; h < end; h += 36e5) {
      const d = local(h);
      const day = d.getHours() === 0;
      if (h === start || !(day || (every && d.getHours() % every === 0))) continue;
      out.push({ at: h, pct: ((h - start) / span) * 100, label: day ? format(d, "EEE d") : format(d, "h a"), day });
    }
    return out;
  }, [start, end, span]);

  const isNow = Math.abs(time - now) < STEP_MS && now >= start;
  const readout = local(time);
  const dayWord = sameDay(time, now) ? "Today" : sameDay(time, now + 864e5) ? "Tomorrow" : format(readout, "EEEE");

  return (
    <section aria-label="Time" className="border-t border-border bg-background px-3 pt-3 pb-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play through time"}
          className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-paprika text-carbon transition-transform duration-150 hover:scale-105 active:scale-95"
        >
          {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5 translate-x-px" fill="currentColor" />}
        </button>

        <div className="min-w-0" aria-live="off">
          <p className="text-2xl leading-none font-bold tracking-tight tabular-nums">{format(readout, readout.getMinutes() ? "h:mm a" : "h a")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayWord}, {format(readout, "MMM d")}
          </p>
        </div>

        {now >= start && now < end && !isNow && (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              onTime(now);
            }}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
          >
            <RotateCcw className="size-4" aria-hidden />
            Now
          </button>
        )}

        <RangePicker now={now} range={range} onRange={(r) => (setPlaying(false), onRange(r))} />
      </div>

      <div className="relative mt-3 h-16 select-none">
        {/* Inset by half the thumb width so bars, ticks and playhead line up with where the native thumb travels. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[9px] inset-y-0">
          {/* Density: how many (filtered) events are on at each moment in the window. */}
          <div className="absolute inset-x-0 top-0 flex h-11 items-end gap-px">
            {bins.counts.map((c, i) => {
              const binPct = ((i + 0.5) / bins.counts.length) * 100;
              return (
                <span
                  key={i}
                  className={cn("min-w-0 flex-1 rounded-t-[1px]", binPct <= pct ? "bg-ink-soft/70" : "bg-dust/60 dark:bg-charcoal")}
                  style={{ height: `${c ? Math.max(8, (c / bins.max) * 100) : 2}%` }}
                />
              );
            })}
          </div>
          {ticks.map((tk) => (
            <span
              key={tk.at}
              className={cn("absolute top-0 border-l", tk.day ? "bottom-0 border-ink-soft/50" : "bottom-1 border-ink-soft/20")}
              style={{ left: `${tk.pct}%` }}
            >
              <span
                className={cn(
                  "absolute bottom-0 left-1 text-xs whitespace-nowrap",
                  tk.day ? "font-semibold text-ink-soft" : "text-muted-foreground",
                )}
              >
                {tk.label}
              </span>
            </span>
          ))}
          <span className="absolute top-0 h-11 w-0.5 -translate-x-1/2 bg-paprika" style={{ left: `${pct}%` }} />
        </div>
        <input
          type="range"
          aria-label="Time on the map"
          aria-valuetext={`${dayWord} ${format(readout, "h:mm a")}`}
          min={start}
          max={end}
          step={STEP_MS}
          value={Math.round((time - start) / STEP_MS) * STEP_MS + start}
          onChange={(e) => {
            setPlaying(false);
            onTime(Number(e.target.value));
          }}
          className="time-range absolute inset-x-0 top-0 h-11 w-full cursor-ew-resize"
        />
      </div>
    </section>
  );
}

function RangePicker({ now, range, onRange }: { now: number; range: Range; onRange: (r: Range) => void }) {
  const dayOptions = Array.from({ length: LAST_DAY + 1 }, (_, i) => ({
    value: i,
    label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : format(local(dayStart(now, i)), "EEE, MMM d"),
  }));
  const seg = "h-9 cursor-pointer rounded-sm px-3 text-sm font-semibold whitespace-nowrap transition-colors duration-200";

  return (
    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
      <div role="group" aria-label="Time range" className="flex rounded-md border border-border bg-card p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={range.key === p.key}
            onClick={() => onRange({ key: p.key, from: p.from, to: p.to })}
            className={cn(seg, range.key === p.key ? "bg-ink text-paper" : "text-ink-soft hover:text-ink")}
          >
            <span className="sm:hidden">{p.short}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={range.key === "custom"}
          onClick={() => onRange({ ...range, key: "custom" })}
          className={cn(seg, range.key === "custom" ? "bg-ink text-paper" : "text-ink-soft hover:text-ink")}
        >
          Custom
        </button>
      </div>

      {range.key === "custom" && (
        <div className="flex items-center gap-2 text-sm">
          <label className="sr-only" htmlFor="range-from">
            From
          </label>
          <select
            id="range-from"
            value={range.from}
            onChange={(e) => {
              const from = Number(e.target.value);
              onRange({ key: "custom", from, to: Math.max(from, range.to) });
            }}
            className="h-9 cursor-pointer rounded-md border border-border bg-card px-2 font-semibold"
          >
            {dayOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">to</span>
          <label className="sr-only" htmlFor="range-to">
            To
          </label>
          <select
            id="range-to"
            value={range.to}
            onChange={(e) => onRange({ key: "custom", from: range.from, to: Number(e.target.value) })}
            className="h-9 cursor-pointer rounded-md border border-border bg-card px-2 font-semibold"
          >
            {dayOptions
              .filter((o) => o.value >= range.from)
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}

const sameDay = (a: number, b: number) => format(local(a), "yyyy-MM-dd") === format(local(b), "yyyy-MM-dd");
