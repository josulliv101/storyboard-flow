"use client";

import { useCallback, useRef, useState } from "react";

import {
  TrimOverviewStrip,
  useCollectionsSelector,
  useLiveTrim,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { useTrimPanel } from "./graph-trim-panel-context";

// The source map, DOCKED under the focused strip (PL10-006).
//
// It used to float above the selected card, and in a nested layout that is a
// promise you cannot keep: the placement rule only asked whether the VIEWPORT
// had room above, so inside a sub-timeline it found plenty — occupied by the
// row above — and parked on it (measured: 21,600px² of a sub-timeline row
// covered). Anything anchored to a card in a scrolling, nested board will
// eventually cover something.
//
// In the flow, that whole class of bug is gone: no placement math, no flip, no
// overlap. It also fixes the precision the floating panel gave away — the map
// spans the strip instead of 304px, which is ~0.05 s/px against 0.17.

/** Live width of the map's slot, so the strip can be told an exact pixel
 *  width (it draws at that width and derives its own scale from it). */
function useMeasuredWidth(): [(element: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      // Read the size the observer already measured; getBoundingClientRect
      // here would force a synchronous layout on every resize.
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) setWidth((previous) => (previous === rect.width ? previous : rect.width));
    });
    observer.observe(element);
    observerRef.current = observer;
    setWidth(element.getBoundingClientRect().width);
  }, []);
  return [ref, width];
}

function DockBody({ node }: Readonly<{ node: VideoMediaNode }>) {
  const live = useLiveTrim(node.id);
  const [slotRef, width] = useMeasuredWidth();

  // Live values (mid-drag) win over the committed trim, so the window tracks
  // a card-handle drag frame-for-frame.
  const trimIn = live ? live.trimInSeconds : node.trimInSeconds;
  const trimOut = live ? live.trimOutSeconds : node.trimOutSeconds;
  const showing = Math.max(0, node.fullDurationSeconds - trimIn - trimOut);

  return (
    <div
      data-trim-dock={node.id}
      // In the flow, so a press here reaches the page-wide click-away rule.
      // The map itself is exempt from it, but the dock's own chrome is not —
      // and clearing the selection would unmount the dock the user is holding.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="flex items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1.5"
    >
      <span className="shrink-0 font-mono text-[10px] text-zinc-500">source</span>
      <span ref={slotRef} className="min-w-0 flex-1">
        {width > 0 ? (
          <TrimOverviewStrip
            node={node}
            width={width}
            trimInSeconds={trimIn}
            trimOutSeconds={trimOut}
          />
        ) : null}
      </span>
      <span className="shrink-0 text-right font-mono text-[10px] leading-tight text-zinc-400">
        <span className="block text-amber-200/90">
          {trimIn.toFixed(1)}s → {(trimIn + showing).toFixed(1)}s
        </span>
        <span className="block text-zinc-500">of {node.fullDurationSeconds.toFixed(1)}s</span>
      </span>
    </div>
  );
}

/**
 * Renders under the focused strip when the trim mode is pinned and a video is
 * selected. Nothing at all otherwise — this is a band in the layout, so an
 * empty one would cost the strip vertical space for no reason.
 */
export function GraphTrimDock() {
  const { pinned } = useTrimPanel();
  const selected = useCollectionsSelector((s) => {
    for (const id of s.interaction.selectedIds) {
      const node = s.graph.nodesById.get(id);
      if (node?.kind === "media" && node.mediaKind === "video") return node;
    }
    return null;
  });

  if (!pinned || selected === null || !selected.src) return null;
  return <DockBody node={selected} />;
}
