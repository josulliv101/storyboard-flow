"use client";

import { memo } from "react";

import { mediaDurationSeconds, videoFrameCount, type MediaNode } from "../core/graph";

// Media preview inside a NodeCard. An IMAGE shows its single `src`; a VIDEO
// shows a SEQUENCE of poster frames (never a <video> element) — more frames
// for a longer clip (`videoFrameCount`), cycling `posterSrcs` when there are
// fewer posters than frames. No media (image without `src`, video without
// `posterSrcs`) falls back to a labeled placeholder. Memoized on the node so
// it re-renders only when the node itself changes, preserving the package's
// render-efficiency model during drags.

export const NodeThumbnail = memo(function NodeThumbnail({ node }: { node: MediaNode }) {
  if (node.mediaKind === "video") {
    const posters = node.posterSrcs ?? [];
    if (posters.length === 0) return <ThumbnailFallback label="No preview" />;
    const count = videoFrameCount(mediaDurationSeconds(node));
    return (
      <span
        data-node-thumbnail="video"
        data-frame-count={count}
        className="flex min-h-0 flex-1 overflow-hidden rounded-sm bg-muted"
      >
        {Array.from({ length: count }).map((_, index) => (
          <img
            key={index}
            src={posters[index % posters.length]}
            alt=""
            draggable={false}
            loading="lazy"
            className="h-full min-w-0 flex-1 border-r border-background object-cover last:border-r-0"
          />
        ))}
      </span>
    );
  }

  if (!node.src) return <ThumbnailFallback label="No image" />;
  return (
    <span
      data-node-thumbnail="image"
      className="flex min-h-0 flex-1 overflow-hidden rounded-sm bg-muted"
    >
      <img
        src={node.src}
        alt=""
        draggable={false}
        loading="lazy"
        className="h-full w-full object-cover"
      />
    </span>
  );
});

function ThumbnailFallback({ label }: { label: string }) {
  return (
    <span
      data-node-thumbnail="fallback"
      className="flex min-h-0 flex-1 items-center justify-center rounded-sm bg-muted text-[9px] text-muted-foreground select-none"
    >
      {label}
    </span>
  );
}
