// Where the floating selection toolbar sits, as arithmetic.
//
// Split out from the component on purpose: this is the part with edges — the
// flip, the two clamps, and the visibility cutoff — and a toolbar rendered into
// a portal is awkward to assert against, while a function that takes four rects
// and returns a point is not. Same seam that made `frame-override.test.ts`
// possible for the preview override.
//
// Everything is in VIEWPORT coordinates, matching `getBoundingClientRect`, and
// the caller writes the result straight to a `position: fixed` element.

export type ToolbarRect = Readonly<{ left: number; top: number; width: number; height: number }>;

export type ToolbarPlacementInput = Readonly<{
  /** The anchor card's live rect, or null when it is not mounted — a strip
   *  virtualizes its cards away, and the grid re-creates a card's element when
   *  a move re-parents it across rows. Absence is normal, not an error. */
  anchorRect: ToolbarRect | null;
  toolbarSize: Readonly<{ width: number; height: number }>;
  /** The sticky board header. It is opaque and it scrolls nothing, so a card
   *  behind it is not visible and the toolbar must not sit under it either. */
  headerRect: ToolbarRect | null;
  /** Width of the icon rail, which is also opaque and pinned. */
  railWidth: number;
  viewport: Readonly<{ width: number; height: number }>;
  /** Distance between the card and the toolbar. Defaults to `TOOLBAR_GAP`;
   *  callers pass a larger one for a coarse pointer, where a toolbar that had
   *  to flip BELOW its card would otherwise sit under the hand that just
   *  tapped it (R11.3). */
  gap?: number;
}>;

export type ToolbarPlacement = Readonly<{
  left: number;
  top: number;
  side: "above" | "below";
  /** False when the toolbar must not render at all: no anchor element, or the
   *  anchor has scrolled far enough behind the header/rail/viewport edge that
   *  pointing at it would be a lie. The selection itself is unaffected. */
  visible: boolean;
}>;

/** Gap between the card and the toolbar, and the minimum breathing room kept
 *  against the rail and the viewport edges. */
export const TOOLBAR_GAP = 8;

/** Below this share of the anchor card still on screen, the toolbar hides and
 *  the header's overflow takes over (R6.6). Half is generous enough that the
 *  toolbar survives ordinary scrolling and strict enough that it never points
 *  at a sliver. */
export const ANCHOR_MIN_VISIBLE_RATIO = 0.5;

const HIDDEN: ToolbarPlacement = { left: 0, top: 0, side: "above", visible: false };

function clamp(value: number, min: number, max: number): number {
  // max first: when the window is narrower than the toolbar the two bounds
  // cross, and honouring the MIN keeps it against the rail rather than sliding
  // under it — the rail is opaque, the right edge merely runs out of room.
  return Math.max(min, Math.min(value, max));
}

function overlap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  return Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
}

/**
 * How much of the anchor card is actually on screen, 0..1.
 *
 * Measured against the region a card can be SEEN in, not the raw viewport: the
 * header band and the rail are opaque and fixed, so a card underneath either is
 * hidden as surely as one scrolled off the bottom. Without that the toolbar
 * would keep tracking a card sliding behind the header and end up pointing at
 * the header itself.
 */
export function anchorVisibleRatio(input: ToolbarPlacementInput): number {
  const { anchorRect, headerRect, railWidth, viewport } = input;
  if (anchorRect === null) return 0;
  const area = anchorRect.width * anchorRect.height;
  if (area <= 0) return 0;

  const contentTop = headerRect === null ? 0 : Math.max(0, headerRect.top + headerRect.height);
  const visibleWidth = overlap(
    anchorRect.left,
    anchorRect.left + anchorRect.width,
    railWidth,
    viewport.width,
  );
  const visibleHeight = overlap(
    anchorRect.top,
    anchorRect.top + anchorRect.height,
    contentTop,
    viewport.height,
  );
  return (visibleWidth * visibleHeight) / area;
}

/**
 * Centre on the anchor, prefer above, flip below when the header is in the way,
 * then clamp into the free horizontal band.
 */
export function resolveToolbarPlacement(input: ToolbarPlacementInput): ToolbarPlacement {
  const { anchorRect, toolbarSize, headerRect, railWidth, viewport } = input;
  const gap = input.gap ?? TOOLBAR_GAP;
  if (anchorRect === null) return HIDDEN;
  if (anchorVisibleRatio(input) < ANCHOR_MIN_VISIBLE_RATIO) return HIDDEN;

  const above = anchorRect.top - toolbarSize.height - gap;
  const headerBottom = headerRect === null ? 0 : Math.max(0, headerRect.top + headerRect.height);
  // "Insufficient space above" is measured against the header, not the viewport
  // top: on the first grid row the header IS the ceiling, and a toolbar tucked
  // between them would be half-covered by an opaque bar.
  const side: "above" | "below" = above >= headerBottom + gap ? "above" : "below";
  const top = side === "above" ? above : anchorRect.top + anchorRect.height + gap;

  // The EDGE clamps stay at the base gap: they are about not colliding with
  // opaque chrome, which a bigger finger does not change.
  const centred = anchorRect.left + anchorRect.width / 2 - toolbarSize.width / 2;
  const left = clamp(
    centred,
    railWidth + TOOLBAR_GAP,
    viewport.width - toolbarSize.width - TOOLBAR_GAP,
  );

  return { left, top, side, visible: true };
}
