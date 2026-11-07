"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const PIN_SVG = `<svg viewBox="0 0 30 40" width="30" height="40" xmlns="http://www.w3.org/2000/svg"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 25.9 15 40 15 40s15-14.1 15-25.2C30 6.6 23.3 0 15 0Z" fill="#eb5e55"/><circle cx="15" cy="14.5" r="5.5" fill="#fffcf2"/></svg>`;

/** Small interactive map centred on the venue with one pin. MapLibre loads only in the browser. */
export function EventMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: { remove(): void } | undefined;
    let observer: MutationObserver | undefined;
    const root = document.documentElement;
    const styleUrl = () => `https://tiles.openfreemap.org/styles/${root.classList.contains("dark") ? "dark" : "positron"}`;
    import("maplibre-gl").then(({ Map, Marker, NavigationControl, setWorkerUrl }) => {
      if (cancelled || !ref.current) return;
      // The bundler can't follow MapLibre's worker import, so the worker is served from /public (see postinstall).
      setWorkerUrl("/maplibre-gl-worker.mjs");
      let current = styleUrl();
      const m = new Map({
        container: ref.current,
        style: current,
        center: [lng, lat],
        zoom: 14.5,
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      m.addControl(new NavigationControl({ showCompass: false }), "top-right");
      const el = document.createElement("div");
      el.className = "event-pin";
      el.innerHTML = PIN_SVG;
      new Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(m);
      map = m;
      // Follow the light/dark toggle.
      observer = new MutationObserver(() => {
        const next = styleUrl();
        if (next !== current) m.setStyle((current = next));
      });
      observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map?.remove();
    };
  }, [lat, lng]);

  return <div ref={ref} role="img" aria-label={`Map showing ${label}`} className="size-full bg-muted" />;
}
