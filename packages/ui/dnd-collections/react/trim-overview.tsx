"use client";

import { memo } from "react";

import { type VideoMediaNode } from "../core/graph";

// Source-window overview for a SELECTED video: the FULL source rendered as a
// poster filmstrip, with an amber window marking what's currently showing
// (positioned by the trim-in offset, sized to the showing duration) and the
// trimmed room dimmed on each side. Mirrors the app's video-source-filmstrip.
//
// Positioned entirely by its caller (VirtualStrip) via `anchorLeft` — the
// clip's own content-space left edge minus `trimInSeconds * pixelsPerSecond`
// — rendered as a DOM child of the SAME scrolled content container the clip
// lives in. That makes the amber window's left/right edges land EXACTLY on
// the clip's rendered edges, for any trim value, and keeps them aligned
// through scroll and live drags for free (no rect tracking, no scroll
// listeners) — see ARCHITECTURE.md's trim section. `trimInSeconds`/
// `trimOutSeconds` are passed in (not read from the node) so a live drag can
// override the committed values before they land.

const fmt1 = (s: number) => `${(Math.round(s * 10) / 10).toFixed(1)}s`;

export const TrimOverviewStrip = memo(function TrimOverviewStrip({
  node,
  pixelsPerSecond,
  anchorLeft,
  trimInSeconds,
  trimOutSeconds,
  top = 0,
}: {
  node: VideoMediaNode;
  pixelsPerSecond: number;
  /** Content-space left edge to render at: `clipLeft - trimInSeconds * pixelsPerSecond`. */
  anchorLeft: number;
  /** Live values during a drag override the node's committed trim. */
  trimInSeconds: number;
  trimOutSeconds: number;
  /** Content-space top offset (the reserved band above the clip row). */
  top?: number;
}) {
  const full = Math.max(0, node.fullDurationSeconds);
  const trimIn = Math.max(0, trimInSeconds);
  const trimOut = Math.max(0, trimOutSeconds);
  const showing = Math.max(0, full - trimIn - trimOut);

  const fullWidth = Math.max(1, full * pixelsPerSecond);
  const trimInWidth = trimIn * pixelsPerSecond;
  const windowWidth = Math.max(2, showing * pixelsPerSecond);

  const posters = node.posterSrcs ?? [];
  const frameW = 78;
  const frameCount = Math.max(1, Math.min(24, Math.round(fullWidth / frameW)));

  return (
    <div
      data-trim-overview={node.id}
      className="absolute h-11 overflow-hidden rounded-md"
      style={{ width: fullWidth, top, transform: `translateX(${anchorLeft}px)` }}
    >
      {/* Full-source filmstrip. */}
      <div className="flex h-full w-full">
        {posters.length === 0 ? (
          <span className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground select-none">
            No preview frames
          </span>
        ) : (
          Array.from({ length: frameCount }).map((_, i) => (
            <img
              key={i}
              src={posters[i % posters.length]}
              alt=""
              draggable={false}
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))
        )}
      </div>

      {/* Dim the trimmed room on each side. */}
      <div className="absolute inset-y-0 left-0 bg-background/55" style={{ width: trimInWidth }} />
      <div
        className="absolute inset-y-0 right-0 bg-background/55"
        style={{ width: trimOut * pixelsPerSecond }}
      />

      {/* The amber "showing" window. */}
      <div
        data-trim-overview-window
        className="absolute inset-y-0 rounded-sm border-2 border-amber-300 bg-amber-300/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
        style={{ width: windowWidth, transform: `translateX(${trimInWidth}px)` }}
      >
        <span className="absolute inset-y-0 left-0 w-2 rounded-l-sm bg-amber-200/90" />
        <span className="absolute inset-y-0 right-0 w-2 rounded-r-sm bg-amber-200/90" />
      </div>

      {/* Full-clip readout. */}
      <span className="pointer-events-none absolute top-0.5 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-2 py-0.5 font-mono text-[9px] text-zinc-100 select-none">
        full clip {fmt1(full)}
      </span>
    </div>
  );
});
