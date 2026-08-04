"use client";

import { createContext, useContext, useEffect, useState } from "react";

import type { FlatItem } from "@storyboard/timeline-domain";

import type { PreviewCardSpans } from "./graph-playhead-model";

// The two CONTEXT seams every time overlay reads: which clock the pane is
// playing, and whether the strip is showing a flat run.
//
// Their own module because both `graph-preview.tsx` (which provides them) and
// `graph-seek-rails.tsx` (which consumes them) need them — re-exporting from
// graph-preview would make the two files import each other, and a cycle around
// module-level `createContext` calls is the kind that bites at evaluation time
// rather than at the type level.



// The per-card time windows (and the maps built from them) live in
// graph-playhead-model.ts — pure and unit-tested; this file only carries the
// React seams. The context publishes the manifest's windows to every playhead
// under the pane: the pane plays the manifest whenever it has one, and the
// live projection only in the ~2.5s window after an edit, so the markers must
// map time→x on the SAME clock the pane is playing or they point at the
// wrong cards (the round-1 #6 bug).
export const PreviewCardSpansContext = createContext<PreviewCardSpans | null>(null);

/**
 * The FLAT run the strip is showing, or null in the ordinary nested reading.
 *
 * Every time overlay — ruler, playhead, seek rail — and the header aggregate
 * derive their card windows from the focused collection's DIRECT children. In
 * a flat run those are the wrong cards, so each of them reads this instead and
 * measures the run actually on screen. Published by the board, which already
 * computes the list for the strip itself, so the marks and the cards can never
 * disagree about what they are describing.
 */
export const FlatItemsContext = createContext<readonly FlatItem[] | null>(null);

/**
 * The flat run this subtree is inside, or `null` when nothing is flattened.
 *
 * Non-null is also the ANSWER to "is this the focused flat strip": the board
 * publishes the run once, around the focused surface, and resets it to `null`
 * around every sub-timeline row — so a consumer that sees items is by
 * construction the one strip whose indices are flat-run boundaries.
 */
export function useFlatItems(): readonly FlatItem[] | null {
  return useContext(FlatItemsContext);
}

export function FlatItemsProvider({
  items,
  children,
}: Readonly<{ items: readonly FlatItem[] | null; children: React.ReactNode }>) {
  return <FlatItemsContext.Provider value={items}>{children}</FlatItemsContext.Provider>;
}


/** The global-clock windows the pane is playing, or null when it is on the
 *  live projection (no manifest yet). Sub-rows use it both to gate their
 *  playhead — only shown when a manifest exists, since only then do their
 *  local times line up with the global clock — and to find their own window. */
export function usePreviewCardSpans(): PreviewCardSpans | null {
  return useContext(PreviewCardSpansContext);
}


/** Publishes the manifest's card windows to every playhead under the pane. */
export function PreviewCardSpansProvider({
  value,
  children,
}: Readonly<{ value: PreviewCardSpans | null; children: React.ReactNode }>) {
  return (
    <PreviewCardSpansContext.Provider value={value}>{children}</PreviewCardSpansContext.Provider>
  );
}

/** Read the raw context — for overlays that also need to know "is it null". */
export function usePreviewCardSpansContext(): PreviewCardSpans | null {
  return useContext(PreviewCardSpansContext);
}

/** The flat run this subtree is inside, raw. */
export function useFlatItemsContext(): readonly FlatItem[] | null {
  return useContext(FlatItemsContext);
}
