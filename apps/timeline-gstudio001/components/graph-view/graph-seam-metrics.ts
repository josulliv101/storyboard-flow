// THE BAR'S SHARED NUMBERS, in one module because they are shared in BOTH
// directions.
//
// The ruler needs the film's box inset, so its blocks land on the same edges
// as the boxes below. The film needs the ruler's height, so the active
// clip's triangle can sit above it. Those two imports are a cycle, and a cycle
// between two component modules is the kind that works until a bundler orders
// them the other way and one side reads `undefined` at module scope — as a
// layout built from NaN rather than as an error anyone could search for.
//
// So the numbers live apart from both. Nothing here imports anything.

/**
 * How far a box is inset from its segment, each side.
 *
 * The gap between two clips is twice this, and it is drawn by ABSENCE — the
 * one part of the bar that says "these are separate". Both rows measure from
 * it: the film's boxes and the scale's blocks, so a block cannot reach into a
 * gap without the box below it doing the same.
 */
export const BOX_INSET_PX = 2.5;

/** How tall the SCALE band is — the numbers, the tick marks, the blocks. */
export const SEAM_RULER_HEIGHT_PX = 20;

/**
 * The band above the scale, holding the collection names and nothing else.
 *
 * They used to sit in the scale among the seconds, which put two kinds of
 * label — one naming a place, one measuring time — on one line competing for
 * the same pixels. Lifted out, each row says one thing: names above, numbers
 * below, and the tick marks in between belonging to both.
 *
 * 14px is the 10px lettering plus its leading and no more; this is a caption
 * strip, not a second scale.
 */
export const SEAM_COLLECTION_BAND_PX = 14;

/**
 * The whole ruler block, names and scale together.
 *
 * What everything OUTSIDE measures from: the fades over the film begin where
 * this ends, and the active clip's mark sits above it. Derived, so moving
 * either band moves them with it.
 */
export const SEAM_RULER_TOTAL_PX = SEAM_COLLECTION_BAND_PX + SEAM_RULER_HEIGHT_PX;

/**
 * How tall the film is.
 *
 * 36px for a long time, which made the frames inside it 30 — enough to tell
 * you a shot was dark or bright and very little else, and the strip is the one
 * place you are meant to know a shot by looking at it. 48 puts the pictures at
 * 42, where a face in a medium shot stops being a smudge.
 *
 * Four things are measured from it: the lane, the fades over its ends, the
 * filmstrip cell size that keeps a cell square, and the hover card's offset
 * below it.
 */
export const SEAM_LANE_HEIGHT_PX = 48;

/**
 * How far below the film the hover card hangs.
 *
 * Measured from the lane's BOTTOM rather than as one offset from its top, so
 * the card keeps its distance when the film changes height instead of climbing
 * into it.
 */
export const SEAM_PREVIEW_GAP_PX = 20;

/**
 * Half the active-clip triangle's width, and its height.
 *
 * It is drawn as two transparent side borders under a solid top one, so the
 * glyph is twice `MARK_HALF_PX` wide and `MARK_HEIGHT_PX` tall, with its tip
 * at its own centre. Named because the borders, the clamp that keeps the mark
 * inside the bar, and the offset that lifts it above the ruler all have to
 * agree.
 */
export const MARK_HALF_PX = 5;
export const MARK_HEIGHT_PX = 6;

/**
 * The gap between the triangle's tip and the top of the ruler.
 *
 * The mark used to sit immediately over the film, inside the ruler's band and
 * among its labels — three things claiming the same 20px. Lifting it clear
 * puts the scale's own contents back in sole possession of the scale, and the
 * mark reads as pointing AT the band rather than as part of it.
 *
 * Small, because it still has to belong to the clip it points at. The rule
 * stays where it was, against the film: the pair is a pointer and a span, and
 * the span is a measurement of the boxes rather than of the scale.
 */
export const MARK_RULER_GAP_PX = 2;

/**
 * How far above the lane's top the triangle's box starts.
 *
 * Derived rather than typed, so a taller ruler moves the mark with it instead
 * of burying it.
 */
export const MARK_TOP_OFFSET_PX =
  SEAM_RULER_TOTAL_PX + MARK_HEIGHT_PX + MARK_RULER_GAP_PX;
