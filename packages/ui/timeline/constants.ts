// Packing constants (CLIP_GAP_SECONDS, TIMELINE_*_PADDING_SECONDS) are part
// of the stored model and live in @storyboard/timeline-model — re-exported
// so every existing "@storyboard/ui/timeline/constants" import keeps
// working. View-layer constants remain defined here.
export {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
  TIMELINE_TRAILING_PADDING_SECONDS,
} from "@storyboard/timeline-model/constants";

export const VIDEO_SOURCES = [
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://www.w3schools.com/html/movie.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/classroom.mp4",
  "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/people-detection.mp4",
  "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/store-aisle-detection.mp4",
  "https://raw.githubusercontent.com/intel-iot-devkit/sample-videos/master/bottle-detection.mp4",
  // `as const` makes this a TUPLE, so the fixed indexes below (VIDEO_SOURCES[0]
  // … [6] in the MEDIA table) are known to exist rather than being
  // `string | undefined` under noUncheckedIndexedAccess. Typing the literal is
  // the honest fix here: the entries really are fixed and really are present.
] as const;

export type ItemSize = "xs" | "sm" | "md" | "lg" | "xl";

export const ITEM_HEIGHTS: Record<ItemSize, number> = {
  xs: 80,
  sm: 120,
  md: 200,
  lg: 280,
  xl: 360,
};

export const ITEM_HEIGHT = 200; // Keep for fallback or default
export const MIN_WIDTH = 60;
export const MAX_WIDTH = 600;
export const DEFAULT_PIXELS_PER_SECOND = 100;
export const DRAG_THRESHOLD_PX = 3;
export const RESIZE_KEY_STEP_PX = 10;
export const VISIBLE_OVERSCAN_PX = 700;
export const FILMSTRIP_HEIGHT = 38;
export const FILMSTRIP_GAP = 6;
export const TIMELINE_ITEM_TOP = FILMSTRIP_HEIGHT + FILMSTRIP_GAP;
export const TIMELINE_HEIGHT = ITEM_HEIGHT + TIMELINE_ITEM_TOP;
export const FILMSTRIP_TARGET_FRAME_WIDTH = 54;
export const FILMSTRIP_MAX_FRAMES = 96;
export const THUMBNAIL_GAP = 16;
