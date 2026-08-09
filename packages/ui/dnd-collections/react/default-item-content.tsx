"use client";

import { memo } from "react";

import {
  hasSourceWindow,
  mediaDurationSeconds,
  type MediaNode,
  type NodeId,
} from "../core/graph";
import { type CollectionItemContentProps } from "./collections-components";
import { roundSecondsForDisplay } from "./duration-format";
import { useLiveTrim } from "./live-trim";
import { NodeThumbnail } from "./node-thumbnail";

// The package's stock card pixels — thumbnail, name, duration/child-count
// label, selection ring, rejection flash, drag-source dimming, and (on
// trim-enabled cards) the duration readouts — extracted from NodeCard so
// consumers can swap in their own. This is also the reference implementation
// for custom content: memoized, presentational (spans only — it renders
// inside a <button>), and driven entirely by the contract props plus the
// opt-in `useLiveTrim` seam. The card BOX (sizing, border-box position)
// belongs to the shell; this fills it and paints everything visible.

/**
 * The trim readouts: the showing/full pill (committed data) and the live
 * preview bubble that tracks a handle drag. A LEAF component on purpose —
 * `useLiveTrim` re-renders its caller per pointer move, so the subscription
 * is scoped to this readout, mounted only on trim-enabled media cards; the
 * rest of the card never re-renders mid-gesture.
 */
function DefaultTrimReadout({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  // Windowed kinds (video, audio) show showing/full; an image has only the one
  // number. Keyed on hasSourceWindow rather than "is video" so audio reads its
  // own `fullDurationSeconds` instead of a `durationSeconds` it does not have.
  const pill = hasSourceWindow(node)
    ? `${mediaDurationSeconds(node).toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
    : `${node.durationSeconds.toFixed(2)}s`;
  return (
    <>
      {/* Showing/full readout pill (bottom-right), matching the app. */}
      <span
        data-trim-pill
        className="pointer-events-none absolute right-1 bottom-1 z-20 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-zinc-100 tabular-nums select-none"
      >
        {pill}
      </span>
      {live !== null && (
        <span
          data-trim-preview={live.effectiveSeconds}
          className="pointer-events-none absolute -top-5 left-1/2 z-30 -translate-x-1/2 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-black shadow"
        >
          {roundSecondsForDisplay(live.effectiveSeconds)}s
        </span>
      )}
    </>
  );
}

export const DefaultItemContent = memo(function DefaultItemContent({
  id,
  node,
  childCount,
  selected,
  rejected,
  isDragSource,
  dragActivation,
  trimEnabled,
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
          {trimEnabled && <DefaultTrimReadout id={id} node={node} />}
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
