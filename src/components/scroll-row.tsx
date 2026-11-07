"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal scroller with edge fades and arrow buttons that appear only on a side that has more to see,
 * so the row reads as scrollable and the first/last item is never left faded.
 * `className` styles the outer box (margins/bleed); `innerClassName` the scrolling flex row (padding/gap).
 */
export function ScrollRow({ children, className, innerClassName, label }: { children: ReactNode; className?: string; innerClassName?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, children]);

  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: reduce ? "auto" : "smooth" });
  };

  const arrow =
    "absolute top-1/2 z-10 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-border bg-popover text-ink shadow-md transition-opacity duration-200 hover:border-ink-soft";

  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={ref}
        onScroll={measure}
        data-fade-left={edges.left || undefined}
        data-fade-right={edges.right || undefined}
        className={cn("scroll-fade flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", innerClassName)}
      >
        {children}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Scroll ${label} left`}
        onClick={() => nudge(-1)}
        className={cn(arrow, "left-1", edges.left ? "opacity-100" : "pointer-events-none opacity-0")}
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Scroll ${label} right`}
        onClick={() => nudge(1)}
        className={cn(arrow, "right-1", edges.right ? "opacity-100" : "pointer-events-none opacity-0")}
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  );
}
