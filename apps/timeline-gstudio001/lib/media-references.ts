// Which stored media a document still POINTS AT — the reference check that
// stands between "Empty Trash" and a permanently deleted asset.
//
// The same uploaded asset can be referenced from several timelines (this app
// mints stable per-asset clip ids, so one asset placed twice is one asset with
// two clips). Deleting the asset behind a trashed clip is therefore only safe
// when nothing OUTSIDE the trash points at it any more. These helpers are pure
// string/JSON work so they can be unit-tested away from Firestore and
// Cloudinary; the scan that feeds them lives in firebase-timeline-store.

/** True for a URL this module can reason about (a Cloudinary delivery URL). */
export function isCloudinaryUrl(value: string): boolean {
  return value.includes("cloudinary.com") && value.includes("/upload/");
}

/** A transformation segment: comma-joined `key_value` pairs, e.g.
 *  `so_0.35,w_640,h_360,c_fill,q_auto,f_jpg` or a lone `w_300`. */
function isTransformSegment(segment: string): boolean {
  return segment
    .split(",")
    .every((part) => /^[a-z]{1,3}_[^,/]+$/.test(part));
}

/** A delivery version stamp: `v1712345678`. */
function isVersionSegment(segment: string): boolean {
  return /^v\d+$/.test(segment);
}

/**
 * The Cloudinary public id a delivery URL resolves to, or null.
 *
 * Everything between `/upload/` and the id can be transformations and a
 * version stamp, and the app stores BOTH shapes: an upload result is plain
 * (`/upload/v1712/folder/pic.png`) while a generated poster carries a
 * transform chain (`/upload/so_0.35,w_640,c_fill/folder/pic.jpg`). Comparing
 * the raw tails would call those two different assets — which, on this path,
 * would mean deleting one that is still in use. Strip the chain and the
 * version, drop the extension, and both collapse onto `folder/pic`.
 */
export function cloudinaryPublicId(url: string): string | null {
  if (!isCloudinaryUrl(url)) return null;
  const afterUpload = url.split("/upload/")[1];
  if (afterUpload === undefined) return null;
  // Delivery URLs carry no query/hash in this app, but a stray one would
  // otherwise become part of the id.
  const path = afterUpload.split(/[?#]/)[0];
  const segments = path.split("/").filter((segment) => segment.length > 0);
  let start = 0;
  while (
    start < segments.length - 1 &&
    (isTransformSegment(segments[start]) || isVersionSegment(segments[start]))
  ) {
    start += 1;
  }
  const id = segments.slice(start).join("/").replace(/\.[^/.]+$/, "");
  return id.length > 0 ? id : null;
}

/**
 * The keys an asset is matched on. `publicId` is the precise one; `basename`
 * (its last path segment) is a deliberately LOOSE fallback, because the two
 * failure directions are not symmetric: keeping an asset nobody references
 * wastes storage, while deleting one that is still referenced breaks a
 * timeline the user can still see. A basename in this app carries an upload
 * timestamp (`beach-1782573064814`), so the looseness costs almost nothing.
 */
export type MediaMatchKeys = Readonly<{ publicId: string; basename: string }>;

export function mediaMatchKeys(url: string): MediaMatchKeys | null {
  const publicId = cloudinaryPublicId(url);
  if (publicId === null) return null;
  return { publicId, basename: publicId.split("/").pop() ?? publicId };
}

/**
 * Every Cloudinary URL anywhere inside `value` — a deep walk, not a read of
 * known fields. A reference can hide in a clip's `src`, a video `poster`, a
 * collection's stored `previewItems`, or whatever a future clip shape adds;
 * missing one of those is what would make this check delete a live asset. The
 * walk is cycle-guarded so a self-referencing record can't hang the request.
 */
export function collectCloudinaryUrls(value: unknown, into = new Set<string>()): Set<string> {
  const seen = new WeakSet<object>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (isCloudinaryUrl(node)) into.add(node);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const item of Object.values(node)) walk(item);
  };
  walk(value);
  return into;
}

/** The match keys for a set of URLs, as the two lookup sets the check uses. */
export function referenceIndex(urls: Iterable<string>): Readonly<{
  publicIds: ReadonlySet<string>;
  basenames: ReadonlySet<string>;
}> {
  const publicIds = new Set<string>();
  const basenames = new Set<string>();
  for (const url of urls) {
    const keys = mediaMatchKeys(url);
    if (keys === null) continue;
    publicIds.add(keys.publicId);
    basenames.add(keys.basename);
  }
  return { publicIds, basenames };
}

/** True when something in the index still points at this asset. */
export function isStillReferenced(
  index: ReturnType<typeof referenceIndex>,
  keys: MediaMatchKeys,
): boolean {
  return index.publicIds.has(keys.publicId) || index.basenames.has(keys.basename);
}
