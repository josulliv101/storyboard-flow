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
 * `count` frame URLs sampled at even times across the clip's VISIBLE range
 * — [trimInSeconds, trimInSeconds + effectiveSeconds]. Frames are read at slot
 * CENTERS ((i + 0.5) / count) so the first isn't the exact in-cut and the last
 * isn't the very tail (both often black). Falls back to the base poster when
 * there is no usable frame URL to transform.
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
    const time = range.trimInSeconds + ((index + 0.5) / slots) * effective;
    urls.push(build(base, time));
  }
  return urls;
}
