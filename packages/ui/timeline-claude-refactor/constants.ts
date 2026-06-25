export const ITEM_HEIGHT = 200;
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

// Gives the first clips room to grow left before hitting time 0.
// Without this, a packed sequence cannot expand a middle clip to the left
// without overlapping earlier clips.
export const TIMELINE_LEADING_PADDING_SECONDS = 5;
export const TIMELINE_TRAILING_PADDING_SECONDS = 5;

// Inertial scroll tuning.
export const INERTIA_FRICTION = 0.95;
export const INERTIA_MIN_VELOCITY = 0.1;
