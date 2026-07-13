"use client";

import { createContext, useContext } from "react";
import { type NodeId } from "../core/graph";

// A view (VirtualStrip) provides this so trim handles can preview a media
// item's new duration LIVE — resizing its card as the handle drags — WITHOUT
// a graph commit (that lands once, on release). The view implements it with
// the virtualizer's targeted `resizeItem` (updates one item + shifts the
// offsets after it; no full re-measure, no per-frame graph churn).
//
// The provided value MUST be stable across the view's renders, or every trim
// handle would re-render on each drag-over — this consumes the context
// directly, bypassing NodeCard's memo. The default is a no-op, so a card in a
// fixed-width view (panels) still trims, it just doesn't live-resize.

/** Live trim split during a drag — carries the in/out values (not just the
 *  resulting duration) so a view can position UI that depends on trimIn
 *  itself, e.g. the overview window's left edge. */
export type LiveTrim = Readonly<{
  trimInSeconds: number;
  trimOutSeconds: number;
  effectiveSeconds: number;
}>;

export type TrimPreview = Readonly<{
  /** Live-resize the item to the drag's current trim split; `null` resets it
   *  to its data-derived size. */
  previewTrim: (nodeId: NodeId, live: LiveTrim | null) => void;
}>;

const NOOP: TrimPreview = { previewTrim: () => {} };

export const TrimPreviewContext = createContext<TrimPreview>(NOOP);

export function useTrimPreview(): TrimPreview {
  return useContext(TrimPreviewContext);
}
