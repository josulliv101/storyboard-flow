import type { ClipDetail } from "@storyboard/timeline-domain";

/** The layout every timeline surface on the page uses — horizontal strip or
 *  2D grid. One toggle drives the focused timeline AND every sub-graph row. */
export type FocusSurface = "strip" | "grid";

export const TIMELINE_PPS = 40;

/**
 * Horizontal zoom: the pixels-per-second a strip lays duration-derived clips
 * out at. Independent of ITEM_SIZE_HEIGHTS, which scales height only — this
 * is the axis that makes a 0.4s clip and a 40s clip legible at once.
 *
 * Collection cards are deliberately NOT affected: they render at a fixed
 * COLLECTION_CARD_PX because their width stands for "a nested timeline", not
 * for elapsed time.
 */
export const MIN_TIMELINE_PPS = 6;
export const MAX_TIMELINE_PPS = 200;
export const DEFAULT_TIMELINE_PPS = TIMELINE_PPS;

export const GRID_GAP = 8;

/** The five steps of the page-wide item size control. */
export type ItemSize = "xs" | "sm" | "md" | "lg" | "xl";

export const ITEM_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

/**
 * Per-size dimensions for the two surfaces.
 *
 * STRIP scales height only: a strip clip's WIDTH is its duration at the live
 * pixels-per-second, so the horizontal time scale is the zoom slider's job,
 * not the size control's — a size change must never move the playhead there.
 *
 * GRID scales BOTH dimensions, proportionally: a grid cell's width is unrelated
 * to duration (it is a wrapped 2-D layout), so scaling only its height stretched
 * cells into wide-short rectangles. Width and height move together now, keeping
 * a ~16:10 thumbnail at every step. The column count is width-derived, so bigger
 * cells simply wrap into fewer columns.
 *
 * `md` is the default; the ladder was rescaled up so the smallest step is a
 * usable "sm-like" size rather than a cramped one.
 */
export const ITEM_SIZE_DIMENSIONS = {
  xs: { strip: 56, gridWidth: 90, gridHeight: 56 },
  sm: { strip: 76, gridWidth: 122, gridHeight: 76 },
  md: { strip: 100, gridWidth: 160, gridHeight: 100 },
  lg: { strip: 132, gridWidth: 211, gridHeight: 132 },
  xl: { strip: 172, gridWidth: 275, gridHeight: 172 },
} as const satisfies Record<
  ItemSize,
  { strip: number; gridWidth: number; gridHeight: number }
>;

export const DEFAULT_ITEM_SIZE: ItemSize = "md";

/**
 * The size one step SMALLER, clamped at the floor. Children timelines render a
 * step below the focused timeline (a flat rule — every descendant is this one
 * size, it does not compound with depth).
 */
export function stepDownItemSize(size: ItemSize): ItemSize {
  const index = ITEM_SIZES.indexOf(size);
  return ITEM_SIZES[Math.max(0, index - 1)];
}

/**
 * The grid `height` prop is a MAXIMUM: VirtualGrid is content-height until its
 * rows exceed this, then scrolls. Graph view never wants that internal scroll —
 * every item should get room and the PAGE scrolls instead — so both the focused
 * and sub-row grids pass this effectively-unbounded cap. (A finite sentinel, not
 * Infinity: the prop contract wants a finite positive number.)
 *
 * KNOWN COST: fit-all currently means RENDER-all. VirtualGrid windows against
 * its own scroll container, and a container that never scrolls has a viewport
 * the size of its content — every row mounts. Fine at today's collection
 * sizes; if collections grow to hundreds of clips, grid mode needs a
 * window-scroll virtualizer (the page owns scrolling now) rather than a
 * bigger cap.
 */
export const GRID_UNCAPPED_HEIGHT = 100_000;
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
