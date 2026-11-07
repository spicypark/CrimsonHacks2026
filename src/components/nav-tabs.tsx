"use client";

import { LayoutList, Map as MapIcon, MoonStar } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const isMap = (p: string) => p === "/map";
const isPlan = (p: string) => p.startsWith("/plan");

const TABS = [
  // Events covers the list and everything reached from it (event and venue pages).
  { href: "/", label: "Events", icon: LayoutList, match: (p: string) => !isMap(p) && !isPlan(p) },
  { href: "/map", label: "Live map", icon: MapIcon, match: isMap },
  { href: "/plan", label: "Plan my night", icon: MoonStar, match: isPlan },
] as const;

// Labels collapse to icons on phones so all three tabs fit beside the logo and theme toggle.
const tab =
  "relative inline-flex h-14 items-center gap-2 px-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200 after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:transition-colors sm:px-3 sm:after:inset-x-3";

/** Header tabs: Events, Live map, Plan my night. */
export function NavTabs() {
  const pathname = usePathname();
  return <TabLinks isActive={(m) => m(pathname)} />;
}

/** Rendered while the pathname resolves (dynamic routes), so the header never jumps. */
export function NavTabsFallback() {
  return <TabLinks isActive={() => false} />;
}

function TabLinks({ isActive }: { isActive: (match: (p: string) => boolean) => boolean }) {
  return (
    <nav aria-label="Main" className="flex">
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = isActive(match);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(tab, active ? "text-floral after:bg-paprika" : "text-dust hover:text-floral after:bg-transparent")}
          >
            <Icon className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
