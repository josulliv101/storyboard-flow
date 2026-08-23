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
/** Opens a notch wider than the packing constant's 40 so clips breathe. */
export const DEFAULT_TIMELINE_PPS = 50;

/**
 * Cards kept mounted beyond each horizontal edge of a graph strip.
 *
 * Video filmstrips discover their frame URLs only when their card mounts.
 * Eight cards gives fast pans roughly a viewport of look-ahead at ordinary
 * clip widths while keeping large timelines bounded by virtualization.
 */
export const GRAPH_STRIP_OVERSCAN_ITEMS = 8;

/**
 * The strip's TRACK: the surface a row of clips sits on.
 *
 * A strip holding nothing — or two clips — used to read as cards floating on
 * the page, because the surface itself was invisible and only a dashed outline
 * suggested it. A filled track says "things go here, in a row" before anything
 * does, which makes it the honest empty state for this surface (the board's
 * other empty affordance, "Add timeline", is a slot INSIDE a row; this is the
 * row).
 *
 * It goes on the SCROLL VIEWPORT, not the content, and that is what makes the
 * hard half free. The track then spans the visible width whatever the content
 * does: with two clips the rest of the row is visible track, and with a
 * thousand the track stays put while the cards scroll over it. Painting it on
 * the content instead would need a third width — beside `getTotalSize()` (the
 * cards' extent, which drop indices read) and the content div's own width
 * (that plus the trailing slot) — and a trailing inset on a SCROLLABLE run is
 * not padding at all; it is a gap that appears mid-content the moment you
 * scroll.
 *
 * Sits BETWEEN the board and the cards tonally, and the ORDER is the
 * constraint: the board is near-black and a card is an opaque `bg-zinc-900`, so
 * the track has to be lighter than the first and darker than the second or it
 * competes with what it is holding. `zinc-900` at 60% lands around a third of
 * the way from the board to a card — lifted enough to read as a surface at a
 * glance, still clearly behind the clips.
 */
export const GRAPH_STRIP_TRACK_CLASS = "bg-zinc-900/60";

/** Gap between grid cells — sized as the seek-rail BAND: the slim track
 *  centres inside it with clear space on both sides, so the rail (and its
 *  thumb) never touches the cards above or below. The strips reserve the
 *  same 16px as top padding (`pt-4`) for their rail. */
export const GRID_GAP = 16;

/** The five steps of the page-wide item size control. */
export type ItemSize = "xs" | "sm" | "md" | "lg" | "xl";

export const ITEM_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

/** Narrows an arbitrary string (e.g. a Radix radio-group value) to `ItemSize`,
 *  validating against `ITEM_SIZES` instead of asserting the type. */
export function isItemSize(value: string): value is ItemSize {
  return (ITEM_SIZES as readonly string[]).includes(value);
}

/**
 * Per-size dimensions for the two surfaces.
 *
 * STRIP scales height only: a strip clip's WIDTH is its duration at the live
 * pixels-per-second, so the horizontal time scale is the zoom slider's job,
 * not the size control's — a size change must never move the playhead there.
 *
 * GRID scales BOTH dimensions. A grid cell's width is unrelated to duration (it
 * is a wrapped 2-D layout), so scaling only its height stretched cells into
 * wide-short rectangles. The column count is width-derived, so bigger cells
 * simply wrap into fewer columns.
 *
 * WHY THE TWO NO LONGER SHARE A HEIGHT. `strip` and `gridHeight` used to be the
 * SAME NUMBER at every step (132 and 132 at `lg`), and the grid card was the
 * strip card at the same size — so switching surfaces produced a layout that
 * looked identical, wrapped. The difference between them is real and large, and
 * nothing on screen said so.
 *
 * They are now deliberately different shapes, not just different arrangements:
 *
 *   - The strip stays SHORT and wide, because width there is time and height is
 *     only legibility. A tall strip wastes vertical space on every row.
 *   - The grid goes TALL and boxy — roughly 5:4 rather than the old 16:10. A
 *     cell that is not measuring anything can afford to be a card: a big
 *     thumbnail with a label that is actually readable under it (the metadata
 *     row grows to match — see `graph-item-content`).
 *
 * At `lg` that is a 220px grid cell against a 132px strip card, and roughly
 * four columns across the board's max width instead of six. Fewer, bigger,
 * squarer — a different way of looking at the same timeline, which is what the
 * surface switch is for.
 */
export const ITEM_SIZE_DIMENSIONS = {
  xs: { strip: 56, gridWidth: 132, gridHeight: 104 },
  sm: { strip: 76, gridWidth: 168, gridHeight: 132 },
  md: { strip: 100, gridWidth: 216, gridHeight: 170 },
  lg: { strip: 132, gridWidth: 280, gridHeight: 220 },
  xl: { strip: 172, gridWidth: 360, gridHeight: 284 },
} as const satisfies Record<
  ItemSize,
  { strip: number; gridWidth: number; gridHeight: number }
>;

export const DEFAULT_ITEM_SIZE: ItemSize = "lg";

/**
 * The size one step SMALLER, clamped at the floor. Children timelines render a
 * step below the focused timeline (a flat rule — every descendant is this one
 * size, it does not compound with depth).
 */
export function stepDownItemSize(size: ItemSize): ItemSize {
  const index = ITEM_SIZES.indexOf(size);
  // One step down, never past the smallest. Unreachable for a non-empty
  // constant — stated so the function stays total whatever the caller passes.
  return ITEM_SIZES[Math.max(0, index - 1)] ?? ITEM_SIZES[0];
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
 *  strip lines up with the LABEL, past everything before it in the header.
 *  Sums the header's own leading run: the tree elbow (w-2 = 8px, pulled 2px
 *  closer by -mr-0.5) + gap-2 (8px) + the folder button (h-5 = 20px) + gap-2
 *  (8px) = 42. Applied structurally per level, so nesting accumulates it.
 *  KEEP IN STEP with that row header — an e2e pins the strip's left edge to
 *  the label's, which is what catches it when they drift. */
export const SUBTIMELINE_INDENT_PX = 42;
/** Stop RECURSING past this depth (render the row, omit its nested children) —
 *  defensive insurance against pathological data; the graph is otherwise a
 *  single-parent tree for navigable collections. */
export const MAX_SUBTREE_DEPTH = 12;

/** Detail for a timeline the graph knows only as a root (no source clip). */
export const FALLBACK_DETAIL: ClipDetail = {
  alt: "",
  aspect: 16 / 9,
};

/**
 * How far each nesting level pushes a sub-timeline row's RIGHT edge inward:
 * the panel's own `p-3` (12px) plus its 1px border. The left indent
 * (SUBTIMELINE_INDENT_PX) is what makes the hierarchy readable and is
 * deliberately NOT cancelled — but the right side accumulating the same way
 * staggered the rows' preview frames, so a depth-3 row's frames sat 39px left
 * of a depth-0 row's and the column read as ragged.
 *
 * COUPLED to the row panel's `p-3 border` classes in graph-sub-timelines.tsx:
 * change the padding or border there and this must change with it. It is a
 * literal because Tailwind needs literal class names, so the two cannot be
 * derived from one source.
 */
export const SUBTIMELINE_PANEL_RIGHT_INSET_PX = 13;

/**
 * The details dialog's PANEL box, shared by the clip modal and the collection
 * modal so the two are one dialog that shows different things — not two
 * dialogs of different size.
 *
 * They had drifted badly: same `max-w-3xl` width, but 588px tall against 253px
 * (measured at an 871px viewport), so moving between a clip and a timeline
 * resized the box by a third of the screen.
 *
 * The height is FIXED here rather than left to the content, because the two
 * bodies carry different chrome — the clip's has trim numbers and a source
 * strip the collection's has no equivalent for, worth ~81px. Matching only the
 * heroes still left that gap. Fixing the panel and letting each hero absorb
 * the remainder (see `DETAILS_HERO_FILL_CLASS`) is what makes them identical:
 * the clip gets a slightly smaller hero because it spends more on controls,
 * and the box never changes.
 *
 * `max-h-full` keeps it inside the scrim's padding on short viewports, where a
 * flat 68vh would otherwise be the taller constraint.
 */
export const DETAILS_PANEL_HEIGHT_CLASS = "h-[68vh] max-h-full";

/**
 * A FLOOR UNDER THE PANEL ROW, and the reason it has to exist.
 *
 * The cards hang from a common bottom, so the row's height is whatever its
 * tallest card is — the subject. Mid-step there is no subject: the outgoing
 * card is shrinking and the incoming one is growing, and they cross in the
 * middle. Measured at 1920, both are 444px at the crossover against a resting
 * 519, so the row loses 75px of height — and because the scrim centres it
 * vertically, EVERY card lifts 37px and settles back.
 *
 * That bob is not either card's animation. It reads as the vertical part of
 * the step finishing early and the horizontal part running on afterwards,
 * which is exactly the wrong description of what the timings actually say.
 *
 * So the row keeps the subject's height whether or not a card currently has
 * it. Matches the panel's own rule — `h-[68vh]` under
 * `max-h-[calc(100vh-26.625rem)]` — expressed as one `min()` because a floor
 * cannot be written as a height and a cap.
 */
export const DETAILS_ROW_FLOOR_CLASS = "min-h-[min(68vh,calc(100vh-26.625rem))]";

/**
 * How a details hero fills whatever the panel's fixed height leaves it.
 *
 * `min-h-0` is not optional: a flex child's default `min-height: auto` refuses
 * to shrink below its content, so without it a tall video would push the panel
 * past its fixed height and the two dialogs would disagree again — the exact
 * failure this pair exists to prevent. Both heroes render with
 * `object-contain`, so the space they are given letterboxes rather than crops.
 */
export const DETAILS_HERO_FILL_CLASS = "min-h-0 flex-1";
