import Link from "next/link";
import { HeaderNav } from "./header-nav";
import { LogoMark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-transparent bg-carbon text-floral dark:border-charcoal">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight">
          <LogoMark className="size-8" />
          <span className="max-sm:sr-only">
            PullUp<span className="text-paprika">.</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <HeaderNav />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
