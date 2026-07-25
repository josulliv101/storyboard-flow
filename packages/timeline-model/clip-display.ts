// How a clip PRESENTS: the thumbnail it shows, the name it goes by, how long
// it reads as, and how wide it should be drawn in a duration-sized strip.
//
// These live here rather than in a view because three separate surfaces had
// each re-derived them and drifted apart: the app's project cards
// (lib/project-thumbnail.ts), the graph cards, and the MCP widget. The widget's
// copy was the one that was wrong. Keeping them in this dependency-free package
// means the server routes, the app, and the sandboxed single-file widget bundle
// can all share one answer without any of them taking on a dependency.
//
// Every function is pure and total: display code runs against data that has
// already been persisted, so a missing field must degrade to a sensible frame
// rather than throw.

/** The shape display code needs from a clip's preview item. Structurally
 *  minimal on purpose: the stored `CollectionTimelineClip["previewItems"]`
 *  satisfies it, and so does the looser JSON a widget receives over the wire. */
export type DisplayPreviewItem = {
  kind?: string;
  src?: string;
  poster?: string;
};

/** The shape display code needs from a clip. See {@link DisplayPreviewItem} for
 *  why this is structural rather than the stored `TimelineClip` union. */
export type DisplayClip = {
  kind?: string;
  title?: string;
  alt?: string;
  src?: string;
  poster?: string;
  duration?: number;
  previewItems?: readonly DisplayPreviewItem[] | null;
  /** Skipped in playback and totals. Display code should MUTE it, not hide
   *  it: the clip keeps its slot and its width everywhere it is drawn, so a
   *  surface that dropped it would disagree with the board about what the
   *  timeline contains. */
  disabled?: boolean;
};

/**
 * Characters a browser will not accept raw in a URL. Space is the one that
 * actually bites; the others are equally illegal and equally cheap to escape.
 *
 * `%` is deliberately ABSENT, and that is the whole design: never touching `%`
 * makes this transformation idempotent by construction, so a URL that is
 * already percent-encoded passes through untouched however many times it runs.
 */
const ILLEGAL_URL_CHARS = /[ "<>`{}|\\^]/g;

/**
 * Normalise a stored media URL so a browser will actually load it.
 *
 * The stored data holds BOTH forms for the same asset: `poster` URLs written
 * before the cloudinary-media-store encoding fix carry LITERAL SPACES for
 * folders like "New Collection", while `src` URLs for the same clip are already
 * percent-encoded. Browsers reject the first, so repair has to happen at render
 * time — the old rows are still out there.
 *
 * Escaping ONLY the illegal characters is what makes this safe. Two simpler
 * approaches both corrupt valid URLs:
 *   - bare `encodeURI` escapes `%` as well, turning a correct `New%20Collection`
 *     into `New%2520Collection`;
 *   - `encodeURI(decodeURI(url))` fixes that case but still mangles escapes for
 *     characters `encodeURI` leaves alone — `%3D` survives `decodeURI` as
 *     literal text and returns as `%253D`, which breaks data URIs and any name
 *     encoded with `encodeURIComponent`.
 */
export function encodeMediaUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Data and blob URLs carry their own encoding and must reach the browser
  // exactly as stored.
  if (/^(data|blob):/i.test(url)) return url;
  return url.replace(ILLEGAL_URL_CHARS, (char) => encodeURIComponent(char));
}

/** The still frame a preview item can supply. */
function previewItemFrame(item: DisplayPreviewItem): string | undefined {
  return item.poster || item.src || undefined;
}

/**
 * The thumbnail a clip shows.
 *
 * `poster` wins over `src` for every kind. For video that is the only sane
 * choice, and for image the poster is the resized derivative rather than the
 * full-size original — cheaper to fetch and already the right aspect.
 *
 * A collection has no art of its own, so it borrows from `previewItems`. It
 * scans rather than reading `[0]`: the first item can legitimately carry no
 * usable URL, and falling straight through to the empty placeholder while later
 * items hold perfectly good frames is exactly the bug this consolidates away.
 */
export function clipPosterUrl(clip: DisplayClip): string | undefined {
  if (clip.kind === "collection") {
    for (const item of clip.previewItems ?? []) {
      const frame = previewItemFrame(item);
      if (frame) return encodeMediaUrl(frame);
    }
    return undefined;
  }
  return encodeMediaUrl(clip.poster || clip.src || undefined);
}

/** The name a clip goes by: a collection's title, otherwise its alt text, with
 *  the kind as a last resort so a card is never captionless. */
export function clipLabel(clip: DisplayClip): string {
  if (clip.kind === "collection") return clip.title || "Collection";
  return clip.alt || clip.title || clip.kind || "Clip";
}

/** Human duration: seconds under a minute, `m:ss` above it. */
export function formatClipDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  // 59.6s rounds to 60 — carry it rather than rendering "1:60".
  if (seconds === 60) return `${minutes + 1}:00`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Tuning for {@link clipStripWidths}. Exposed so stories can exercise the
 *  curve at other sizes without redefining it. */
export type ClipStripWidthOptions = {
  /** Width of the shortest clip in the strip. Floors readability: a caption and
   *  a kind badge still have to fit. */
  minWidth?: number;
  /** Width of the longest clip in the strip. */
  maxWidth?: number;
  /** Compression applied to the duration ratio. 1 is strictly proportional;
   *  below 1 pulls extremes together. */
  exponent?: number;
};

export const CLIP_STRIP_MIN_WIDTH = 104;
export const CLIP_STRIP_MAX_WIDTH = 280;
/** Square root. Chosen because real timelines are wildly uneven — a 104s
 *  collection next to a 3.5s still is a 30:1 ratio, and drawing that literally
 *  makes every short clip an unreadable sliver. */
export const CLIP_STRIP_EXPONENT = 0.5;

function safeDuration(clip: DisplayClip): number {
  const duration = clip.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return duration;
}

/**
 * Pixel width for each clip in a duration-sized strip, in clip order.
 *
 * Returns PIXELS, not percentages, and that is the fix for the bug this
 * replaced. Percentage widths inside a flex row look proportional only while
 * the row fits: once the bases overflow, `flex-shrink` takes the most from the
 * widest item while a `min-width` floor protects the narrowest, and the strip
 * collapses to near-equal cards — the exact opposite of what a timeline should
 * show. Absolute widths with `flex-shrink: 0` keep the proportions identical at
 * every container size and let the strip scroll instead.
 *
 * Widths are scaled against the LONGEST clip so the strip always spans its full
 * range: the longest clip is `maxWidth`, and everything else falls between that
 * and `minWidth` along a compressed curve. A clip with no usable duration draws
 * at `minWidth` rather than disappearing.
 *
 * Note that only WIDTH varies. Card height is uniform across the strip (see
 * `--clip-art-height` in the widget's stylesheet): a row of ragged-height cards
 * reads as broken when embedded in a chat transcript.
 */
export function clipStripWidths(
  clips: readonly DisplayClip[],
  options: ClipStripWidthOptions = {},
): number[] {
  const minWidth = options.minWidth ?? CLIP_STRIP_MIN_WIDTH;
  const maxWidth = options.maxWidth ?? CLIP_STRIP_MAX_WIDTH;
  const exponent = options.exponent ?? CLIP_STRIP_EXPONENT;
  const span = Math.max(0, maxWidth - minWidth);

  const durations = clips.map(safeDuration);
  const longest = durations.reduce((max, duration) => Math.max(max, duration), 0);

  // Nothing to scale against (empty strip, or every duration missing): a
  // uniform strip is the honest rendering, and it keeps this total.
  if (longest <= 0) return durations.map(() => minWidth);

  return durations.map((duration) => {
    if (duration <= 0) return minWidth;
    const relative = (duration / longest) ** exponent;
    return Math.round(minWidth + span * relative);
  });
}
