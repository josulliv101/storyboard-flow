'use client';

import React from 'react';

type PreviewResizeDividerProps = {
  previewPanelPercent: number;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

export function PreviewResizeDivider({
  previewPanelPercent,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: PreviewResizeDividerProps) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize preview panel"
      aria-valuemin={28}
      aria-valuemax={78}
      aria-valuenow={Math.round(previewPanelPercent)}
      tabIndex={0}
      className="group relative z-30 h-2 shrink-0 cursor-row-resize bg-[#050505] outline-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-900 transition-colors group-hover:bg-indigo-500/70 group-focus-visible:bg-indigo-400" />
      <div className="absolute left-1/2 top-1/2 h-1.5 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-800 bg-zinc-950 transition-colors group-hover:border-indigo-400/50 group-focus-visible:border-indigo-300" />
    </div>
  );
}
