"use client";

import { useState } from "react";
import type { Category } from "@/shared/event";
import { CategoryArt } from "./category-visual";

/** Source image with a designed category fallback (also used when the remote image fails to load). */
export function EventThumb({ src, category, className }: { src: string | null; category: Category | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const base = `${className ?? ""} overflow-hidden bg-muted`;
  if (!src || failed) return <CategoryArt category={category} className={`${base} grid place-items-center`} />;
  return (
    <div className={base}>
      {/* Remote images come from arbitrary event hosts, so next/image remotePatterns can't enumerate them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </div>
  );
}
