import Link from "next/link";
import { Suspense } from "react";
import { NavTabs, NavTabsFallback } from "./nav-tabs";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-transparent bg-carbon text-floral dark:border-charcoal">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          PullUp<span className="text-paprika">.</span>
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
