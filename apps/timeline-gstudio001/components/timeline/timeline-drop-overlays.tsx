type TimelineDropOverlayProps = {
  isVisible: boolean;
};

type TimelineDropIndicatorProps = {
  itemHeight: number;
  itemTop: number;
  left: number;
};

export function TimelineDropOverlay({ isVisible }: TimelineDropOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-sky-400 bg-sky-950/40 backdrop-blur-sm transition-all duration-300">
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sky-200 pointer-events-none">
        <svg
          className="h-10 w-10 animate-bounce text-sky-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        <p className="font-semibold text-sm">Drop to insert media</p>
        <p className="text-xs text-sky-300/80">Images or Video clips (clamped to max 12s)</p>
      </div>
    </div>
  );
}

export function TimelineDropIndicator({
  itemHeight,
  itemTop,
  left,
}: TimelineDropIndicatorProps) {
  return (
    <div
      className="absolute z-40 w-[4px] -ml-[2px] bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] pointer-events-none transition-all duration-100"
      style={{
        left: `${left}px`,
        height: `${itemHeight}px`,
        top: `${itemTop}px`,
      }}
    >
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-sky-400 w-3.5 h-3.5 flex items-center justify-center text-[9px] font-extrabold text-zinc-950 shadow-md">
        +
      </div>
    </div>
  );
}
