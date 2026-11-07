"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Events", match: (p: string) => p === "/" || p.startsWith("/events") },
  { href: "/plan", label: "Plan my night", match: (p: string) => p.startsWith("/plan") },
];

/** Top-level tabs in the header. */
export function HeaderNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-9 items-center rounded-md px-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 sm:px-3",
              active ? "bg-charcoal text-floral" : "text-dust hover:text-floral",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
