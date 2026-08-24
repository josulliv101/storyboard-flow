// How tall the bar's film strip is drawn, and the three sizes offered.
//
// Its own module for the reason the view count and the reach have one: the
// height is a layout decision shared by the thing that draws the film and the
// picker that sets it, and neither should own the other's constant.

import { SEAM_LANE_HEIGHT_PX } from "./graph-seam-metrics";

export const LANE_SIZES = ["sm", "md", "lg"] as const;
export type LaneSize = (typeof LANE_SIZES)[number];

/**
 * The pixel height of each size.
 *
 * `sm` IS THE EXISTING NUMBER, not a new small one — the bar has always drawn
 * a 48px film and that stays exactly what it was, so adding this control
 * changes nothing until it is used. The other two are the sizes worth having
 * rather than a scale: 64 is enough to recognise a face in a box, and 88 is
 * enough to judge a frame without leaving the bar for the panels below.
 *
 * A CELL IS SQUARE (see `FILMSTRIP_CELL_PX`), so the height also sets how many
 * frames a clip's box is cut into — a taller film is a coarser filmstrip, not
 * just a bigger one. That is the trade this control actually makes.
 */
const LANE_HEIGHTS: Readonly<Record<LaneSize, number>> = {
  sm: SEAM_LANE_HEIGHT_PX,
  md: 64,
  lg: 88,
};

export function laneHeightFor(size: LaneSize): number {
  return LANE_HEIGHTS[size];
}

/**
 * The last size chosen, kept at module scope.
 *
 * Deliberately NOT persisted, for the same reason as the reach and the view
 * count: it is a working posture for a session rather than a preference, and a
 * board reopened tomorrow should start at the compact reading.
 */
let rememberedSize: LaneSize = "sm";

export function lastLaneSize(): LaneSize {
  return rememberedSize;
}

export function rememberLaneSize(size: LaneSize): void {
  rememberedSize = size;
}
