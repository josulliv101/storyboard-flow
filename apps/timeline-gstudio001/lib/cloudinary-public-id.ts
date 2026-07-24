/**
 * Encode a Cloudinary public id for use in a URL path.
 *
 * A public id carries its folder path, and a folder name may contain spaces
 * (or anything else illegal in a URL path). An asset's `url` is Cloudinary's
 * own `secure_url`, which arrives already encoded — but hand-built
 * transformation URLs (thumbnails/posters) must encode it themselves.
 * Interpolating the raw id produced posters containing literal spaces
 * (`.../New Collection/...`), which browsers refuse to load: a broken
 * thumbnail for every asset in a folder whose name has a space, while the
 * clip's own image still worked. That asymmetry is what made it look like
 * flaky rendering rather than a URL bug.
 *
 * Encode each SEGMENT, not the whole id — `encodeURIComponent` over the whole
 * string turns the `/` separators into `%2F` and flattens the folder path.
 *
 * Kept free of `server-only` (unlike its caller) so it stays unit-testable:
 * it is pure string handling with no server dependency.
 */
export function encodePublicIdPath(publicId: string): string {
  return publicId.split("/").map(encodeURIComponent).join("/");
}
