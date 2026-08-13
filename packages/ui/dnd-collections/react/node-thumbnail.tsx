"use client";

import { memo, useState } from "react";

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
    return <VideoThumbnail key={JSON.stringify(posters)} node={node} posters={posters} />;
  }

  // AUDIO HAS NO PICTURE, and it has a `src` — so without this it fell through
  // to the image branch and rendered `<img src="…/take.flac">`: a broken image
  // on every audio card. The same shape as #312, where audio sailed through
  // gates that only ever asked "is it video?".
  //
  // Labelled "Audio" rather than "No preview": the other fallbacks describe a
  // picture that is missing or failed, and this one is neither — there was
  // never going to be a picture, and saying so is not an error state.
  if (node.mediaKind === "audio") return <ThumbnailFallback label="Audio" />;

  if (!node.src) return <ThumbnailFallback label="No image" />;
  return <ImageThumbnail key={node.src} src={node.src} />;
});

function ImageThumbnail({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ThumbnailFallback label="Image unavailable" />;
  return (
    <span
      data-node-thumbnail="image"
      className="flex min-h-0 flex-1 overflow-hidden rounded-sm bg-muted"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

function VideoThumbnail({
  node,
  posters,
}: {
  node: MediaNode & { mediaKind: "video" };
  posters: readonly string[];
}) {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  if (posters.every((src) => failedSources.has(src))) {
    return <ThumbnailFallback label="Preview unavailable" />;
  }
  const count = videoFrameCount(mediaDurationSeconds(node));
  const markFailed = (src: string) => {
    setFailedSources((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
      return next;
    });
  };
  return (
    <span
      data-node-thumbnail="video"
      data-frame-count={count}
      className="flex min-h-0 flex-1 overflow-hidden rounded-sm bg-muted"
    >
      {Array.from({ length: count }).map((_, index) => {
        const src = posters[index % posters.length];
        const frameClass =
          "h-full min-w-0 flex-1 border-r border-background object-cover last:border-r-0";
        return failedSources.has(src) ? (
          <span
            key={index}
            aria-hidden="true"
            data-thumbnail-frame-fallback
            className={`${frameClass} bg-muted-foreground/15`}
          />
        ) : (
          <img
            key={index}
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => markFailed(src)}
            className={frameClass}
          />
        );
      })}
    </span>
  );
}

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
