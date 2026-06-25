export const VIDEO_SOURCES = [
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://www.w3schools.com/html/movie.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
];

export type ItemSize = "sm" | "md" | "lg" | "xl";

export const ITEM_HEIGHTS: Record<ItemSize, number> = {
  sm: 120,
  md: 200,
  lg: 280,
  xl: 360,
};

export const ITEM_HEIGHT = 200; // Keep for fallback or default
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 600;
export const DEFAULT_PIXELS_PER_SECOND = 100;
export const CLIP_GAP_SECONDS = 0.12;
export const DRAG_THRESHOLD_PX = 3;
export const RESIZE_KEY_STEP_PX = 10;
export const VISIBLE_OVERSCAN_PX = 700;
export const FILMSTRIP_HEIGHT = 38;
export const FILMSTRIP_GAP = 6;
export const TIMELINE_ITEM_TOP = FILMSTRIP_HEIGHT + FILMSTRIP_GAP;
export const TIMELINE_HEIGHT = ITEM_HEIGHT + TIMELINE_ITEM_TOP;
export const FILMSTRIP_TARGET_FRAME_WIDTH = 54;
export const FILMSTRIP_MAX_FRAMES = 14;
export const THUMBNAIL_GAP = 16;

// Gives the first clips room to grow left before hitting time 0.
export const TIMELINE_LEADING_PADDING_SECONDS = 0;
export const TIMELINE_TRAILING_PADDING_SECONDS = 0;
