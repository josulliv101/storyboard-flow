"use client";

import { memo, useContext } from "react";
import { FolderDown } from "lucide-react";

import {
  mediaDurationSeconds,
  useLiveTrim,
  videoFrameCount,
  type CollectionGhostContentProps,
  type CollectionItemContentProps,
  type CollectionTrimHandleContentProps,
  type CollectionsComponents,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { useClipDetail, useTimelineTitle } from "./graph-details-context";
import { GraphViewNavContext } from "./graph-navigation";

/** Leaf subscription: only the clip being trimmed re-renders per pointer move. */
function LiveDurationPill({ id, node }: { id: NodeId; node: MediaNode }) {
  const live = useLiveTrim(id);
  const showing = live ? live.effectiveSeconds : mediaDurationSeconds(node);
  return (
    <span className="pointer-events-none absolute right-1 bottom-1 z-10 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-zinc-100">
      {node.mediaKind === "video"
        ? `${showing.toFixed(2)}s / ${node.fullDurationSeconds.toFixed(2)}s`
        : `${showing.toFixed(2)}s`}
    </span>
  );
}

const GraphClipContent = memo(function GraphClipContent({
  id,
  node,
  childCount,
  selected,
  rejected,
  isDragSource,
  trimEnabled,
}: CollectionItemContentProps) {
  const detail = useClipDetail(id as string);
  // Same source of truth as the tree/breadcrumb, so a rename shows here too.
  const title = useTimelineTitle(id as string);
  const nav = useContext(GraphViewNavContext);

  if (node.kind === "collection") {
    const hydrated = detail?.hydrated === true;
    const count = hydrated ? childCount : (detail?.itemCount ?? childCount);
    // FIRST and LAST only — the card says "a timeline runs from here to
    // there", which two frames tell and three do not. A single-item
    // collection has no "last" distinct from its first, so it shows one
    // frame across the full width rather than the same image twice.
    const all = detail?.previewItems ?? [];
    const previews = all.length > 1 ? [all[0], all[all.length - 1]] : all;
    const displayName = title ?? node.name;
    // Interaction split: the card BODY selects (like any clip — see
    // openOnClick in graph-timeline-view no longer opening collections), and
    // the big folder button is the ONE thing that drills in. Selected cards
    // can then be trashed with Delete alongside media.
    return (
      <span
        title="Click to select · click the folder to open · press O to open"
        className={[
          "relative flex h-full w-full flex-col justify-between overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.08] p-1.5",
          selected ? "ring-2 ring-amber-400" : "",
          rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
          isDragSource ? "opacity-40" : "",
        ].join(" ")}
      >
        {/* `relative` so the folder button can centre itself over the seam
            between the two frames rather than sitting in the label strip. */}
        <span className="relative flex min-h-0 flex-1 gap-0.5 overflow-hidden">
          {previews.length === 0 ? (
            <span className="flex flex-1 items-center justify-center text-[9px] text-zinc-500">
              {hydrated ? "Empty" : "Open to load"}
            </span>
          ) : (
            previews.map((preview) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={preview.id}
                src={preview.poster ?? preview.src}
                alt=""
                draggable={false}
                loading="lazy"
                className="h-full min-w-0 flex-1 rounded-sm object-cover"
              />
            ))
          )}
          {/* The drill affordance: a large button, sized as a fraction of the
              card so it stays prominent at every item size. stopPropagation on
              pointerdown keeps a press on it from starting the card's drag or
              selecting it — the button opens, the body selects. */}
          <button
            type="button"
            aria-label={`Open ${displayName}`}
            title="Open this timeline"
            data-collections-keyboard-ignore
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              nav?.openTimeline(id as NodeId);
            }}
            className="absolute left-1/2 top-1/2 flex aspect-square h-[46%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/70 text-sky-200 ring-1 ring-sky-400/50 backdrop-blur-[2px] transition-colors hover:bg-zinc-900/85 hover:text-sky-100 hover:ring-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <FolderDown className="h-[55%] w-[55%]" />
          </button>
        </span>
        <span className="mt-1 flex items-center justify-between gap-1">
          <span className="truncate text-[10px] font-semibold text-zinc-100">{displayName}</span>
          <span className="shrink-0 font-mono text-[9px] text-zinc-400">{count}</span>
        </span>
      </span>
    );
  }

  const isVideo = node.mediaKind === "video";
  const posters = isVideo ? (node.posterSrcs ?? []) : node.src ? [node.src] : [];
  const frames = isVideo ? videoFrameCount(mediaDurationSeconds(node), 6) : 1;
  return (
    <span
      className={[
        "relative flex h-full w-full overflow-hidden rounded-md bg-zinc-900",
        selected ? "ring-2 ring-amber-400" : "ring-1 ring-white/15",
        rejected ? "ring-2 ring-red-500 motion-safe:animate-pulse" : "",
        isDragSource ? "opacity-40" : "",
      ].join(" ")}
    >
      {posters.length === 0 ? (
        <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">
          No preview
        </span>
      ) : (
        <span className="flex h-full w-full">
          {Array.from({ length: frames }).map((_, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={posters[index % posters.length]}
              alt=""
              draggable={false}
              loading="lazy"
              className="h-full min-w-0 flex-1 border-r border-black/60 object-cover last:border-r-0"
            />
          ))}
        </span>
      )}
      {trimEnabled && <LiveDurationPill id={id} node={node} />}
    </span>
  );
});

const GraphTrimHandle = memo(function GraphTrimHandle({
  side,
}: CollectionTrimHandleContentProps) {
  // Handles exist only on SELECTED clips (trimRequiresSelection at the
  // provider), so these pixels are always the active affordance — no
  // hover-reveal state for unselected cards to style anymore.
  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center bg-amber-400 opacity-95",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      <span className="h-4 w-0.5 rounded bg-black/60" />
    </span>
  );
});

const GraphGhost = memo(function GraphGhost({ node, extraCount }: CollectionGhostContentProps) {
  return (
    <span className="relative flex h-full w-full flex-col justify-between rounded-md bg-zinc-900/95 p-2 text-xs shadow-2xl ring-2 ring-amber-400">
      <span className="truncate font-semibold text-zinc-100">{node.name}</span>
      <span className="font-mono text-[10px] text-zinc-400">
        {node.kind === "collection" ? "Timeline" : `${mediaDurationSeconds(node).toFixed(2)}s`}
      </span>
      {extraCount > 0 && (
        <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 px-1 text-[11px] font-bold text-black shadow">
          +{extraCount}
        </span>
      )}
    </span>
  );
});

export const GRAPH_VIEW_COMPONENTS: CollectionsComponents = {
  ItemContent: GraphClipContent,
  TrimHandleContent: GraphTrimHandle,
  GhostContent: GraphGhost,
};
