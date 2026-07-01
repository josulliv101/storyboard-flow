import React from "react";

export function ClipGrowingOppositeOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[1px] transition-all">
      <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-black/80 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-xl">
        <span>Growing Opposite</span>
        <svg
          className="h-4 w-4 animate-pulse"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14 5l7 7m0 0l-7 7m7-7H3"
          />
        </svg>
      </div>
    </div>
  );
}
