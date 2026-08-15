// THE SHAPE OF THE FINISHED FILE.
//
// Here rather than in the app's render code because it is STORED now: a
// project carries the format it exports at, so the choice survives a reload
// and every render of that project agrees. The app's `lib/render/types.ts`
// aliases this rather than declaring a second one — two shapes for "how big is
// the output" is exactly how a preview and a render come to disagree.

export type RenderFormat = Readonly<{
  width: number;
  height: number;
  fps: number;
}>;

/**
 * What a project renders at when it has not said otherwise.
 *
 * 16:9, which is a DELIVERABLE decision rather than a description of the
 * sources. Worth writing down because the sources argue the other way: the
 * reference film is 2.379:1, the assembled 35s cut 2.333:1, and the verified
 * MiniMax H3 output size is 1152x480, which is 2.4:1 exactly — so a 2.4:1
 * render is what fills the frame with no bars today.
 *
 * 16:9 is the default anyway because it is what the finished thing is FOR, and
 * because the per-project setting is the answer to "but this project isn't".
 * Anything scope-shaped letterboxes into it, which is the ordinary cost of
 * delivering scope content to a 16:9 target.
 */
export const DEFAULT_RENDER_FORMAT: RenderFormat = {
  width: 1280,
  height: 720,
  fps: 24,
};

/** The named formats the board offers. Free values are still legal — the MCP
 *  render tool takes any width/height/fps — these are just the ones worth one
 *  click. */
export const RENDER_FORMAT_PRESETS: readonly Readonly<{
  id: string;
  label: string;
  ratio: string;
  format: RenderFormat;
}>[] = [
  { id: "hd", label: "720p", ratio: "16:9", format: { width: 1280, height: 720, fps: 24 } },
  { id: "fhd", label: "1080p", ratio: "16:9", format: { width: 1920, height: 1080, fps: 24 } },
  // The size this project's generated shots actually come out at, and what
  // every render before this used.
  { id: "scope", label: "Scope", ratio: "2.4:1", format: { width: 1152, height: 480, fps: 24 } },
  { id: "vertical", label: "Vertical", ratio: "9:16", format: { width: 720, height: 1280, fps: 24 } },
];

/**
 * A stored format defended rather than trusted.
 *
 * HONOURED, not derived — whatever is here decides the size of the file — so
 * anything that is not a usable format has to fall back to the default rather
 * than reach ffmpeg. An odd dimension is rejected along with the nonsense
 * ones: libx264 refuses odd width or height in yuv420p outright, so storing
 * one would produce a project that simply cannot render.
 */
export function renderFormatOf(value: unknown): RenderFormat | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { width, height, fps } = value as Record<string, unknown>;
  const usable = (n: unknown, min: number, max: number, even: boolean): n is number =>
    typeof n === "number" && Number.isInteger(n) && n >= min && n <= max && (!even || n % 2 === 0);
  if (!usable(width, 2, 7680, true)) return undefined;
  if (!usable(height, 2, 4320, true)) return undefined;
  if (!usable(fps, 1, 120, false)) return undefined;
  return { width, height, fps };
}

export function sameRenderFormat(a: RenderFormat, b: RenderFormat): boolean {
  return a.width === b.width && a.height === b.height && a.fps === b.fps;
}

/** The preset a stored format came from, or undefined for a custom one — the
 *  board names what it can and shows the numbers otherwise. */
export function renderFormatPresetOf(format: RenderFormat) {
  return RENDER_FORMAT_PRESETS.find((preset) => sameRenderFormat(preset.format, format));
}
