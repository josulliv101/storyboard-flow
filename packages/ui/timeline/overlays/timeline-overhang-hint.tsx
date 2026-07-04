type TimelineOverhangHintProps = {
  onClick: () => void;
};

export function TimelineOverhangHint({ onClick }: TimelineOverhangHintProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Filmstrip extends beyond the visible area. Click to scroll and reveal the full source filmstrip."
      className="absolute left-1.5 top-1/2 z-50 flex -translate-y-1/2 items-center gap-1 rounded-full border border-amber-400/40 bg-zinc-900/90 px-2 py-1 text-amber-400 shadow-lg shadow-black/40 backdrop-blur-sm transition-all hover:border-amber-400/70 hover:bg-zinc-800/90 hover:shadow-amber-400/10 active:scale-95"
    >
      <svg
        className="h-3.5 w-3.5 animate-pulse"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      <span className="text-[9px] font-semibold uppercase tracking-wide">
        Source
      </span>
    </button>
  );
}
