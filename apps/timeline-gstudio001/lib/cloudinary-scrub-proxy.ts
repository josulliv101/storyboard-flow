/**
 * A small, fast-seeking stand-in for a full-res clip, used only while the
 * playhead is MOVING.
 *
 * Seeking an <video> is asynchronous and keyframe-bound: landing mid-GOP means
 * decoding forward from the preceding keyframe, and the cost scales with frame
 * size. Measured on this project's own asset (832x480, 10s, Cloudinary):
 *
 *   full-res original      p50  67-128ms
 *   w_480,q_auto:low       p50  14-20ms
 *
 * That is the difference between roughly eight frame updates a second under a
 * drag and fifty — between a scrubber that sticks and one that tracks the hand.
 *
 * DERIVED, NOT STORED. The proxy is a delivery transform, so it costs nothing
 * to mint and nothing to keep in sync: the same asset, asked for smaller.
 * Cloudinary builds it on first request and caches it thereafter.
 *
 * RESOLUTION IS THE LEVER, not keyframe interval. Forcing an all-intra proxy
 * (`ki_0.04`) was measured too: it reaches the same floor while costing 2.8-3.3x
 * the bytes, because at these frame sizes decoding forward through a GOP is
 * already cheap. Small beats seekable here.
 */
const SCRUB_PROXY_TRANSFORM = "w_480,q_auto:low";

/** Cloudinary VIDEO delivery URLs only — the one shape this transform is valid for. */
const CLOUDINARY_VIDEO_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/i;

/**
 * The proxy URL for a full-res source, or null when there isn't one.
 *
 * Null is the normal answer for anything not served as a Cloudinary video —
 * a blob: URL from an in-progress upload, a fixture asset in Storybook, an
 * image clip. Callers treat null as "scrub the real thing", which is exactly
 * today's behaviour, so a source this cannot transform is never made worse.
 */
export function cloudinaryScrubProxySrc(src: string): string | null {
  const match = CLOUDINARY_VIDEO_UPLOAD.exec(src);
  if (!match) return null;
  const delivery = match[1]!;
  const rest = match[2]!;
  // ALREADY A PROXY. Re-wrapping would chain the transform onto itself, and a
  // second `w_480` on an already-480 derivative is a pointless round trip.
  if (rest.startsWith(`${SCRUB_PROXY_TRANSFORM}/`)) return src;
  // BEFORE any version segment (`v1786…`): Cloudinary requires transforms to
  // precede the version, and rejects the other order.
  return `${delivery}${SCRUB_PROXY_TRANSFORM}/${rest}`;
}
