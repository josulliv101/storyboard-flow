import type { ClipDetail } from "@storyboard/timeline-domain";

export const TIMELINE_PPS = 40;

export const GRID_CELL_WIDTH = 160;
export const GRID_CELL_HEIGHT = 96;
export const GRID_GAP = 8;

/** Sub-graph tree: pixels of indent added per nesting level. */
export const SUBTIMELINE_INDENT_PX = 20;
/** Stop RECURSING past this depth (render the row, omit its nested children) —
 *  defensive insurance against pathological data; the graph is otherwise a
 *  single-parent tree for navigable collections. */
export const MAX_SUBTREE_DEPTH = 12;
/** Clamp the VISUAL indent so deep trees don't starve strip width. */
export const MAX_INDENT_DEPTH = 6;

/** Detail for a timeline the graph knows only as a root (no source clip). */
export const FALLBACK_DETAIL: ClipDetail = {
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
};
