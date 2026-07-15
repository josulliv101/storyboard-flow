"use client";

import { memo } from "react";

import { mediaDurationSeconds } from "../core/graph";
import { type CollectionItemContentProps } from "./collections-components";
import { roundSecondsForDisplay } from "./duration-format";
import { NodeThumbnail } from "./node-thumbnail";

// The package's stock card pixels — thumbnail, name, duration/child-count
// label, selection ring, rejection flash, drag-source dimming — extracted
// from NodeCard so consumers can swap in their own. This is also the
// reference implementation for custom content: memoized, presentational
// (spans only — it renders inside a <button>), and driven entirely by the
// contract props. The card BOX (sizing, border-box position) belongs to the
// shell; this fills it and paints everything visible.

export const DefaultItemContent = memo(function DefaultItemContent({
  node,
  childCount,
  selected,
  rejected,
  isDragSource,
  dragActivation,
}: CollectionItemContentProps) {
  const isCollection = node.kind === "collection";
  return (
    // A span (display:flex) because content renders inside a <button>, where
    // only phrasing content is valid HTML.
    <span
      className={[
        "flex h-full w-full flex-col items-stretch justify-between rounded-md border p-2 text-left text-xs transition-all",
        // Leave room for the shell's grip bar overlay in handle mode.
        dragActivation === "handle" ? "pt-6" : "",
        isCollection ? "bg-muted/60" : "bg-background",
        selected ? "border-primary ring-2 ring-primary" : "border-border",
        // Static red ring is the always-on rejection cue; the pulse is
        // motion-gated so reduced-motion users still get the ring, no throb.
        rejected ? "border-destructive ring-2 ring-destructive motion-safe:animate-pulse" : "",
        // Dragged cards sit dimmed in place under the ghost.
        isDragSource ? "opacity-40" : "",
      ].join(" ")}
    >
      {node.kind === "media" ? (
        <>
          <NodeThumbnail node={node} />
          <span className="mt-1 flex items-center justify-between gap-1">
            <span className="truncate font-medium text-foreground">{node.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {roundSecondsForDisplay(mediaDurationSeconds(node))}s
            </span>
          </span>
        </>
      ) : (
        <>
          <span className="truncate font-medium text-foreground">{node.name}</span>
          <span className="text-[10px] text-muted-foreground">
            Collection · {childCount} items
          </span>
        </>
      )}
    </span>
  );
});
