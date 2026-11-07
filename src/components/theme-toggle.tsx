"use client";

import { Moon, Sun } from "lucide-react";

/** Runs before first paint (inlined in <head>) so the theme applies without a flash. Dark unless the visitor picked light. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

/** Light/dark switch. The icon is chosen by CSS from the <html> class, so there's no hydration mismatch. */
export function ThemeToggle() {
  const toggle = () => {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid size-11 cursor-pointer place-items-center rounded-md text-floral transition-colors duration-200 hover:text-paprika"
    >
      <Moon className="size-5 dark:hidden" aria-hidden />
      <Sun className="hidden size-5 dark:block" aria-hidden />
      <span className="sr-only">Toggle dark mode</span>
    </button>
  );
}
