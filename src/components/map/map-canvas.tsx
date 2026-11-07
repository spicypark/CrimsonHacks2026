"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibre, Marker, Popup } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTimeRange, shortDate } from "@/lib/events/format";
import { TIER_LABELS } from "@/lib/events/popularity";
import type { PlacedEvent } from "./live-map";

/** Salt Lake Valley, roughly Ogden-to-Lehi kept in reach. */
const VALLEY_CENTER: [number, number] = [-111.88, 40.70];
const BOUNDS: [[number, number], [number, number]] = [[-113.2, 39.7], [-110.6, 41.7]];
const TIER_Z = { hot: 4, popular: 3, quiet: 2, unrated: 1 } as const;
const EXIT_MS = 180;
/** Full-colour street map (parks, water, roads). Deliberately the same in light and dark mode. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type MapLib = typeof import("maplibre-gl");
interface Pin {
  marker: Marker;
  el: HTMLElement;
}

/**
 * Full-bleed MapLibre map. Pins are DOM markers so they can animate in and out
 * as `visibleIds` changes with the time slider.
 */
export function MapCanvas({ events, visibleIds }: { events: PlacedEvent[]; visibleIds: Set<string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [ctx, setCtx] = useState<{ lib: MapLib; map: MapLibre; popup: Popup } | null>(null);
  const pins = useRef(new Map<string, Pin>());
  /** Pins mid exit-animation, with the timer that removes them. */
  const leaving = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Event whose popup is open, so it can close when that pin leaves. */
  const openId = useRef<string | null>(null);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibre | undefined;
    const current = pins.current;
    const exits = leaving.current;
    import("maplibre-gl").then((lib) => {
      if (cancelled || !ref.current) return;
      lib.setWorkerUrl("/maplibre-gl-worker.mjs"); // see postinstall: the bundler can't follow MapLibre's worker import
      map = new lib.Map({
        container: ref.current,
        style: STYLE_URL,
        center: VALLEY_CENTER,
        zoom: 10.3,
        minZoom: 8,
        maxBounds: BOUNDS,
        attributionControl: { compact: true },
      });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      const popup = new lib.Popup({ offset: 14, closeButton: true, maxWidth: "280px", className: "live-popup" });
      setCtx({ lib, map, popup });
    });
    return () => {
      cancelled = true;
      for (const timer of exits.values()) clearTimeout(timer);
      exits.clear();
      current.clear();
      map?.remove();
    };
  }, []);

  // Diff markers against the visible set: new ones pop in, departing ones shrink out.
  useEffect(() => {
    if (!ctx) return;
    const { lib, map, popup } = ctx;
    const current = pins.current;
    const exits = leaving.current;

    const open = (e: PlacedEvent) => {
      openId.current = e.id;
      popup.setLngLat([e.lng, e.lat]).setOffset([e.offset[0], e.offset[1] - 12]).setDOMContent(popupContent(e, router.push)).addTo(map);
    };

    for (const id of visibleIds) {
      const existing = current.get(id);
      if (existing) {
        const timer = exits.get(id);
        if (timer) {
          clearTimeout(timer);
          exits.delete(id);
          existing.el.classList.remove("is-leaving");
        }
        continue;
      }
      const e = byId.get(id);
      if (!e) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "live-pin";
      el.dataset.tier = e.tier;
      el.style.zIndex = String(TIER_Z[e.tier]);
      el.setAttribute("aria-label", `${e.title}, ${TIER_LABELS[e.tier].toLowerCase()}`);
      el.innerHTML = `<span class="live-pin-dot"></span>`;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        open(e);
      });
      const marker = new lib.Marker({ element: el, offset: e.offset }).setLngLat([e.lng, e.lat]).addTo(map);
      current.set(id, { marker, el });
    }

    for (const [id, pin] of current) {
      if (visibleIds.has(id) || exits.has(id)) continue;
      if (openId.current === id) {
        popup.remove();
        openId.current = null;
      }
      pin.el.classList.add("is-leaving");
      exits.set(
        id,
        setTimeout(() => {
          pin.marker.remove();
          current.delete(id);
          exits.delete(id);
        }, EXIT_MS),
      );
    }
  }, [ctx, visibleIds, byId, router]);

  return <div ref={ref} role="region" aria-label="Map of events in the Salt Lake Valley" className="size-full bg-muted" />;
}

/** Built with DOM APIs (never innerHTML) because titles come from scraped sources. */
function popupContent(e: PlacedEvent, navigate: (href: string) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "live-popup-body";
  const href = `/events/${e.id}`;

  const title = document.createElement("a");
  title.href = href;
  title.className = "live-popup-title";
  title.textContent = e.title;
  title.addEventListener("click", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    ev.preventDefault();
    navigate(href);
  });

  const when = document.createElement("p");
  when.textContent = `${shortDate(e.startsAt)}, ${formatTimeRange(e.startsAt, e.endsAt, false)}`;

  root.append(title, when);
  if (e.venueName) {
    const venue = document.createElement("p");
    venue.textContent = e.venueName;
    root.append(venue);
  }

  const meta = document.createElement("p");
  meta.className = "live-popup-meta";
  const swatch = document.createElement("span");
  swatch.className = "live-pin-swatch";
  swatch.dataset.tier = e.tier;
  meta.append(swatch, ` ${TIER_LABELS[e.tier]}${e.isFree ? ", free" : ""}`);
  root.append(meta);
  return root;
}
