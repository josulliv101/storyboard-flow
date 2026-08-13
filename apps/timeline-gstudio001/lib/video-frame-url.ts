// Vendor-agnostic seam for sampling a video FRAME at a specific source time.
//
// A video card shows a filmstrip of frames across the clip. The engine only
// stores a poster or two, so the card used to CYCLE them — a short clip showed
// the same still repeated, which reads as broken (R6 #6/#8). Instead we ask a
// pluggable builder for a frame URL at each wanted timestamp.
//
// The builder contract is provider-neutral: `(frameUrl, timeSeconds) => url`.
// Given an existing frame URL for the clip, return one that renders the frame
// at `timeSeconds`. A provider that can't (or an unrecognized URL) returns the
// input unchanged, so the card degrades to the poster it already had.

/** Turn an existing clip frame URL into one for the frame at `timeSeconds`. */
export type VideoFrameUrlBuilder = (frameUrl: string, timeSeconds: number) => string;

/** Round to hundredths — enough precision for a thumbnail, and keeps the URL
 *  (and thus the CDN cache key) stable across sub-frame pointer jitter. */
function frameTime(seconds: number): number {
  return Math.max(0, Math.round(seconds * 100) / 100);
}

/**
 * Cloudinary implementation of the seam. A Cloudinary video-frame URL is
 * `.../video/upload/<transforms>/<publicId>.jpg`, where a `so_<seconds>`
 * (start-offset) transform selects which frame is extracted. We rewrite that
 * offset — or inject one when the URL has none — to the wanted time. Non-video
 * or non-Cloudinary URLs pass straight through (caller falls back to the
 * poster). This function IS the "map to Cloudinary's contract" the seam allows;
 * another provider supplies its own `VideoFrameUrlBuilder`.
 */
export const cloudinaryVideoFrameUrl: VideoFrameUrlBuilder = (frameUrl, timeSeconds) => {
  if (!frameUrl.includes("/video/upload/")) return frameUrl;
  const time = frameTime(timeSeconds);
  // An existing so_<num> transform, preceded by "/" or "," in the chain.
  if (/[/,]so_[\d.]+/.test(frameUrl)) {
    return frameUrl.replace(/([/,]so_)[\d.]+/, `$1${time}`);
  }
  // No offset yet — add one as the first transform after upload/.
  return frameUrl.replace("/video/upload/", `/video/upload/so_${time},`);
};

/** The app's default builder. Swap this (or inject a different one) to support
 *  another provider — nothing above the seam names Cloudinary. */
export const defaultVideoFrameUrlBuilder: VideoFrameUrlBuilder = cloudinaryVideoFrameUrl;

/**
 * Resolve the still shown when a media item represents a collection.
 *
 * Images keep their source unchanged. A video with a front trim asks the
 * provider seam for the frame at that exact source time, so the collection
 * represents the first usable frame rather than the discarded beginning.
 * Providers that cannot address frames return the existing poster unchanged.
 */
export function collectionPreviewFrameUrl(
  preview: Readonly<{
    kind: "image" | "video";
    src: string;
    poster?: string;
    trimIn?: number;
  }>,
  build: VideoFrameUrlBuilder = defaultVideoFrameUrlBuilder,
): string {
  const base = preview.poster ?? preview.src;
  if (preview.kind !== "video" || !preview.poster || (preview.trimIn ?? 0) <= 0) {
    return base;
  }
  return build(base, preview.trimIn ?? 0);
}

/** How far short of the range's exact end the LAST slot samples. The very
 *  final frame of an encode is often black or a fade-out remnant; a beat
 *  before it is the frame a person means by "the end of the clip". */
const LAST_FRAME_BACKOFF_SECONDS = 0.05;

/**
 * How far PAST the range's exact start a single-frame thumbnail samples.
 *
 * The mirror of the back-off above, and for the same reason: the exact in-cut
 * of an encode is frequently black or a fade-in remnant. At 24fps this is
 * roughly one frame in — indistinguishable from "the first frame" to a viewer,
 * and the difference between a thumbnail and a black square.
 *
 * It is NOT applied to a trimmed clip's in-point, which is a frame the user
 * chose deliberately and is mid-source rather than at an encode boundary.
 */
const FIRST_FRAME_NUDGE_SECONDS = 0.05;

/**
 * `count` frame URLs sampled at even times across the clip's VISIBLE range
 * — [trimInSeconds, trimInSeconds + effectiveSeconds]. Interior frames are
 * read at slot CENTERS ((i + 0.5) / count) so the first isn't the exact
 * in-cut (often black); the LAST slot is pinned to the range's end (minus a
 * small back-off) so the strip always finishes on the clip's final frame
 * (R7 #3). Falls back to the base poster when there is no usable frame URL
 * to transform.
 *
 * A SINGLE slot is the exception at both ends: it is a thumbnail standing for
 * the whole clip, not one cell of a strip, and the slot-centre rule put it at
 * the clip's MIDPOINT — the owner's report, and wrong for a card whose job is
 * to say "this is that shot". It samples the START instead. Pinning it to the
 * end was already rejected for the same reason in reverse.
 */
export function videoFrameUrls(
  posters: readonly string[],
  count: number,
  range: Readonly<{ trimInSeconds: number; effectiveSeconds: number }>,
  build: VideoFrameUrlBuilder = defaultVideoFrameUrlBuilder,
): string[] {
  const slots = Math.max(0, Math.floor(count));
  if (posters.length === 0 || slots === 0) return [];
  const base = posters[0];
  const effective = Math.max(0, range.effectiveSeconds);
  const urls: string[] = [];
  for (let index = 0; index < slots; index += 1) {
    // A lone slot is a THUMBNAIL for the whole clip: it opens on the clip's
    // first frame rather than its midpoint. Nudged off an untrimmed encode's
    // exact zero, where a black frame is common; a real trim in-point is taken
    // as given, since the user picked it and it is not an encode boundary.
    const singleFrameTime =
      range.trimInSeconds > 0
        ? range.trimInSeconds
        : Math.min(FIRST_FRAME_NUDGE_SECONDS, effective / 2);
    const time =
      slots === 1
        ? singleFrameTime
        : index === slots - 1
          ? range.trimInSeconds + Math.max(effective / 2, effective - LAST_FRAME_BACKOFF_SECONDS)
          : range.trimInSeconds + ((index + 0.5) / slots) * effective;
    urls.push(build(base, time));
  }
  return urls;
}
