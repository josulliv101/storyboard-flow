// WHERE AN UNDER-LAYER DRAWS INSIDE THE PICTURE.
//
// A clip on lane 1 or above runs UNDER the picture — that is what the model has
// always meant, and it stays exactly true of sound: its audio is mixed beneath
// the cut. It cannot be true of a PICTURE. Something drawn under the picture is
// not dimly visible, it is not visible at all. So a layer with a frame is
// composited OVER, in a sub-rectangle of the output: "under" describes the mix,
// "over" describes the screen, and both are the same clip.
//
// The rectangle is stored NORMALIZED, 0..1 of the output frame, because the
// output size is a per-render setting (`DEFAULT_RENDER_FORMAT` today, an
// override from the render tool) and a pixel rectangle would mean something
// different at every size.
//
// HEIGHT IS NOT STORED. It follows from the clip's own aspect, so an inset can
// never be stretched — there is no way to express a distorted one, which is the
// only thing anybody would ever do with the extra degree of freedom by mistake.

/**
 * The stored rectangle: top-left corner and width, normalized to the output
 * frame. Top-left rather than centre because that is what both consumers want
 * — canvas `drawImage` and ffmpeg `overlay=x:y` are both corner-addressed.
 */
export type LayerFrame = Readonly<{
  x: number;
  y: number;
  width: number;
}>;

/** A resolved rectangle, height included, in the same normalized units. */
export type LayerRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type LayerFramePosition =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export type LayerFrameSize = "small" | "medium" | "large";

/** Every position, in READING ORDER — which is also the order a 3x3 picker
 *  lays them out, so a consumer can map straight over it. */
export const LAYER_FRAME_POSITIONS: readonly LayerFramePosition[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

/** Smallest first. */
export const LAYER_FRAME_SIZES: readonly LayerFrameSize[] = ["small", "medium", "large"];

/** Width as a fraction of the frame. Three steps rather than a number, because
 *  the useful range is narrow and picking from it is faster than typing into
 *  it. A free rect can still be written directly; these are just the presets. */
const SIZE_WIDTHS: Readonly<Record<LayerFrameSize, number>> = {
  small: 0.2,
  medium: 0.3,
  large: 0.45,
};

/**
 * The gap from the edge, as a fraction of frame WIDTH.
 *
 * Applied to the vertical edges through `frameAspect` rather than reused
 * directly, or it would not look like a margin at all: the render format is
 * 1152x480, so a flat 0.035 is 40px at the sides and 17px top and bottom — an
 * inset visibly hugging the floor while floating away from the wall.
 */
const MARGIN = 0.035;

/** Bottom-right, medium — the corner a picture-in-picture goes in unless you
 *  say otherwise, and small enough to sit over a corner of the shot rather than
 *  compete with it. */
export const DEFAULT_LAYER_POSITION: LayerFramePosition = "bottom-right";
export const DEFAULT_LAYER_SIZE: LayerFrameSize = "medium";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The inset's height, normalized to the frame.
 *
 * `width` is a fraction of frame WIDTH and the answer is a fraction of frame
 * HEIGHT, so both aspects appear: `width * frameAspect` converts to pixels
 * relative to the frame's height, and dividing by the clip's own aspect is what
 * keeps the clip undistorted.
 */
export function layerFrameHeight(width: number, clipAspect: number, frameAspect: number): number {
  const aspect = clipAspect > 0 ? clipAspect : 1;
  return (width * frameAspect) / aspect;
}

/**
 * A stored frame resolved against a real output size and a real clip.
 *
 * Clamped into the frame rather than refused. A stored rectangle can be older
 * than the format it is being rendered at — the render tool takes width, height
 * and fps — so a frame that fitted when it was written can hang off the edge
 * later. Cropping the picture at the boundary is a worse answer than nudging
 * the inset back inside it.
 */
export function layerFrameRect(
  frame: LayerFrame,
  clipAspect: number,
  frameAspect: number,
): LayerRect {
  const width = clamp(frame.width, 0, 1);
  const height = clamp(layerFrameHeight(width, clipAspect, frameAspect), 0, 1);
  return {
    x: clamp(frame.x, 0, 1 - width),
    y: clamp(frame.y, 0, 1 - height),
    width,
    height,
  };
}

/**
 * A preset resolved to the rectangle that gets stored.
 *
 * Presets and a free rectangle produce the SAME stored shape, which is the
 * point: dragging an inset around later writes exactly what picking a corner
 * writes, so the drag is additive rather than a second representation to keep
 * in step.
 */
export function layerFrameForPreset(
  position: LayerFramePosition,
  size: LayerFrameSize,
  clipAspect: number,
  frameAspect: number,
): LayerFrame {
  const width = SIZE_WIDTHS[size];
  const height = layerFrameHeight(width, clipAspect, frameAspect);
  const marginX = MARGIN;
  // See MARGIN: the same gap in pixels, expressed against the other axis.
  const marginY = MARGIN * frameAspect;

  const left = marginX;
  const middleX = (1 - width) / 2;
  const right = 1 - marginX - width;
  const top = marginY;
  const middleY = (1 - height) / 2;
  const bottom = 1 - marginY - height;

  const x =
    position === "top-left" || position === "left" || position === "bottom-left"
      ? left
      : position === "top-right" || position === "right" || position === "bottom-right"
        ? right
        : middleX;
  const y =
    position === "top-left" || position === "top" || position === "top-right"
      ? top
      : position === "bottom-left" || position === "bottom" || position === "bottom-right"
        ? bottom
        : middleY;

  // Through the same clamp every stored frame goes through, so a preset on an
  // extreme aspect cannot produce something a hand-written frame could not.
  const rect = layerFrameRect({ x, y, width }, clipAspect, frameAspect);
  return { x: rect.x, y: rect.y, width: rect.width };
}

/**
 * A stored value defended rather than recomputed.
 *
 * This field is HONOURED — whatever is here is where the inset draws — so
 * anything that is not a real in-range rectangle has to fall back to "no
 * picture" rather than putting a layer somewhere nobody asked for. Same rule as
 * `placedStartOf`, and the opposite of a derived field like `startTime`, which
 * is simply recalculated.
 *
 * A zero or negative width is dropped: an inset of no width is not a smaller
 * inset, it is an invisible one, and storing it would be indistinguishable from
 * meaning it.
 */
export function layerFrameOf(value: unknown): LayerFrame | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const frame = value as Record<string, unknown>;
  const { x, y, width } = frame;
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) return undefined;
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) return undefined;
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 1) {
    return undefined;
  }
  return { x, y, width };
}

/** Whether two frames are the same rectangle. The graph's placement command
 *  compares fields with `===` to decide whether anything changed, which for an
 *  object is always "yes" — every dispatch would push a no-op onto undo. */
export function sameLayerFrame(a: LayerFrame | undefined, b: LayerFrame | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width;
}
