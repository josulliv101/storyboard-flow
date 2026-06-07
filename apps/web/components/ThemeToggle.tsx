"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-900/40 animate-pulse border border-zinc-200 dark:border-zinc-850" />
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="p-1.5 text-zinc-500 hover:text-zinc-850 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-850/60 cursor-pointer transition-all flex items-center justify-center w-8 h-8 outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50 shrink-0"
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-zinc-400 hover:text-amber-400 transition-colors" />
      ) : (
        <Moon className="w-4 h-4 text-zinc-600 hover:text-indigo-600 transition-colors" />
      )}
    </button>
  );
}
