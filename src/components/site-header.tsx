import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "./logo";
import { NavTabs, NavTabsFallback } from "./nav-tabs";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-transparent bg-carbon text-floral dark:border-charcoal">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight">
          <LogoMark className="size-8" />
          <span className="max-sm:sr-only">
            PullUp<span className="text-paprika">.</span>
          </span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <Suspense fallback={<NavTabsFallback />}>
            <NavTabs />
          </Suspense>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
