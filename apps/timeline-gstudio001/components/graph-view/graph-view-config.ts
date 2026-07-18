import type { ClipDetail } from "@storyboard/timeline-domain";

export const TIMELINE_PPS = 40;

export const GRID_CELL_WIDTH = 160;
export const GRID_CELL_HEIGHT = 96;
export const GRID_GAP = 8;

/** Detail for a timeline the graph knows only as a root (no source clip). */
export const FALLBACK_DETAIL: ClipDetail = {
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
};
