"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { isTagFilterMiss, toggleTagKey } from "@/lib/tag-facets";

import { useClipDetail } from "./graph-details-context";

// Filtering the board by tag, WITHOUT changing what the board renders.
//
// This dims non-matching cards. It deliberately does not hide them, and that is
// the whole design decision — hiding is where this feature would have broken
// things that have nothing to do with tags:
//
//   * `VirtualStrip.resolveBoundary` returns an index into the list it
//     rendered, and `resolveCommandFromIntent` clamps that index against the
//     graph's FULL child list. Render a shorter list and every drop lands
//     somewhere else, with no type error and no throw. The drop INDICATOR is
//     pure geometry, so it keeps pointing at the correct gap while the
//     committed index is wrong — exactly how the flat-mode drop bug survived
//     its first fix.
//   * `VirtualGrid` renders straight from `getChildren` and has no override
//     prop at all, so the grid would need the same seam invented for it.
//   * Ctrl/Cmd+A selects `getChildren(...)` regardless of view state, and the
//     header's Delete acts on that selection — so a hiding filter would let
//     someone delete cards they cannot see.
//   * Alt+arrow moves index into `getChildren` too, so a move under a hiding
//     filter would swap a card past a hidden neighbour: a reorder nobody saw.
//   * `childSpans` zips `getChildren` against `graphChildrenToClips` BY INDEX,
//     which is what keeps the ruler, playhead and seek rail aligned.
//
// Every one of those stays correct here by construction, because the rendered
// list is still `getChildren`. If a genuinely hidden view is ever wanted it
// should be a separate filtered VIEW that declares its index space is not the
// graph's — the shape flat mode already uses — not a filter over the live
// editing board.

type TagFilterValue = Readonly<{
  activeTags: ReadonlySet<string>;
  toggleTag: (tag: string) => void;
  clear: () => void;
}>;

const EMPTY: ReadonlySet<string> = new Set();

const TagFilterContext = createContext<TagFilterValue>({
  activeTags: EMPTY,
  toggleTag: () => {},
  clear: () => {},
});

export function TagFilterProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [activeTags, setActiveTags] = useState<ReadonlySet<string>>(EMPTY);
  const value = useMemo<TagFilterValue>(
    () => ({
      activeTags,
      toggleTag: (tag) => setActiveTags((current) => toggleTagKey(current, tag)),
      clear: () => setActiveTags(EMPTY),
    }),
    [activeTags],
  );
  return <TagFilterContext.Provider value={value}>{children}</TagFilterContext.Provider>;
}

export function useTagFilter(): TagFilterValue {
  return useContext(TagFilterContext);
}

/**
 * True when a filter is on and THIS item does not carry any active tag.
 *
 * A miss, not a match: with no filter running every card must read normally, so
 * the default has to be "not missed" rather than "not matched".
 *
 * OR across the active set, not AND. The question being asked is "show me the
 * SCAIL-2 takes and the keepers", and a card carrying either belongs in that
 * answer; requiring every tag would make a second selection almost always empty
 * and read as a bug.
 */
export function useTagFilterMiss(nodeId: string): boolean {
  const { activeTags } = useTagFilter();
  const detail = useClipDetail(nodeId);
  return isTagFilterMiss(activeTags, detail?.tags);
}
