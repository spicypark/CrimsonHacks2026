"use client";

import { LayoutList, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "List", icon: LayoutList, match: (p: string) => p !== "/map" },
  { href: "/map", label: "Live map", icon: MapIcon, match: (p: string) => p === "/map" },
] as const;

const tab =
  "relative inline-flex h-14 items-center gap-2 px-3 text-sm font-semibold transition-colors duration-200 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:transition-colors sm:px-4 sm:after:inset-x-4";

/** The two ways to browse: the list (every page that isn't the map) and the live map. */
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
    <nav aria-label="Browse" className="flex">
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
