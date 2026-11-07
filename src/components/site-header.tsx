import Link from "next/link";
import { Suspense } from "react";
import { LogoMark } from "./logo";
import { NavTabs, NavTabsFallback } from "./nav-tabs";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-transparent bg-carbon text-floral dark:border-charcoal">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="group flex items-center gap-2 text-xl font-bold tracking-tight">
          <LogoMark className="size-8" />
          <span>
            PullUp<span className="text-paprika">.</span>
          </span>
        </Link>
        <Suspense fallback={<NavTabsFallback />}>
          <NavTabs />
        </Suspense>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
