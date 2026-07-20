import type { ClipDetail } from "@storyboard/timeline-domain";

/** The layout every timeline surface on the page uses — horizontal strip or
 *  2D grid. One toggle drives the focused timeline AND every sub-graph row. */
export type FocusSurface = "strip" | "grid";

export const TIMELINE_PPS = 40;

export const GRID_CELL_WIDTH = 160;
export const GRID_GAP = 8;

/** The five steps of the page-wide item size control. */
export type ItemSize = "xs" | "sm" | "md" | "lg" | "xl";

export const ITEM_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

/**
 * Item size scales HEIGHT ONLY — the strip's row height and the grid's cell
 * height. Widths stay where they were: a strip clip's width is its duration at
 * TIMELINE_PPS, so the horizontal time scale is identical at every step and a
 * size change never moves the playhead. The grid keeps GRID_CELL_WIDTH for the
 * same reason (its column count, and so its time→x mapping, is width-derived).
 *
 * `md` reproduces the sizes the page used before the control existed.
 */
export const ITEM_SIZE_HEIGHTS = {
  xs: { strip: 44, gridCell: 56 },
  sm: { strip: 64, gridCell: 76 },
  md: { strip: 88, gridCell: 96 },
  lg: { strip: 120, gridCell: 132 },
  xl: { strip: 156, gridCell: 172 },
} as const satisfies Record<ItemSize, { strip: number; gridCell: number }>;

export const DEFAULT_ITEM_SIZE: ItemSize = "md";

/** Max viewport height of a sub-graph row's GRID (it hugs content up to this
 *  cap, then scrolls) — smaller than the focused grid so nested rows stay
 *  compact. */
export const SUBTIMELINE_GRID_MAX_HEIGHT = 280;
/** Sub-graph tree: left indent of a row's body (strip + nested rows) so the
 *  strip lines up with the LABEL, past the folder icon. Matches the header's
 *  folder button (h-5 = 20px) + gap-2 (8px). Applied structurally per level,
 *  so nesting accumulates it. */
export const SUBTIMELINE_INDENT_PX = 28;
/** Stop RECURSING past this depth (render the row, omit its nested children) —
 *  defensive insurance against pathological data; the graph is otherwise a
 *  single-parent tree for navigable collections. */
export const MAX_SUBTREE_DEPTH = 12;

/** Detail for a timeline the graph knows only as a root (no source clip). */
export const FALLBACK_DETAIL: ClipDetail = {
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
};
