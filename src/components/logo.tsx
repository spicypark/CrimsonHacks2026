import { cn } from "@/lib/utils";

/**
 * PullUp mark: the sun pulling up out of a Wasatch valley. Mountains take `currentColor`; the sun is paprika.
 * The sun rises once on load (skipped under reduced motion). Keep in sync with `src/app/icon.svg`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)} fill="none">
      <defs>
        <clipPath id="pullup-sky">
          <rect width="32" height="28" />
        </clipPath>
      </defs>
      <g clipPath="url(#pullup-sky)">
        <g className="logo-sun">
          <circle cx="16" cy="18" r="7.5" fill="var(--paprika)" />
          <path d="M16 8V5.5M8.9 10.9 7.2 9.2M23.1 10.9l1.7-1.7" stroke="var(--paprika)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </g>
      <path d="M1 28 8 16l3.5 4 2-1.5 3 4 3.5-4.5 2 2 2.5-4.5L31 28Z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
