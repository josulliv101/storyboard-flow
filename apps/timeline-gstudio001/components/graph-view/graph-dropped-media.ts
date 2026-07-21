// Classifying an OS FILE drop for the graph. Kept as a pure `.ts` module —
// no React/DOM — so it can be unit-tested (the app's Vitest cannot parse the
// `.tsx` component that consumes it) and so the rule lives in ONE place.
//
// The File API lets `File.type` be an empty string when the user agent cannot
// determine a MIME type (https://www.w3.org/TR/FileAPI/#dfn-type), and some
// agents report `application/octet-stream` instead. Filtering purely on an
// `image/` or `video/` MIME prefix therefore silently discarded valid media
// that the upload boundary (getMediaContentType in firebase-media-store) can
// already classify from the filename extension. This helper mirrors that same
// extension fallback so the graph accepts exactly what the pipeline can store.

/** The media kinds a dropped file can become in the graph. */
export type DroppedMediaKind = "image" | "video";

/**
 * Image/video extensions the upload pipeline already supports (see
 * `getMediaContentType`). Kept deliberately in lockstep with it: broadening
 * one without the other reintroduces the accept-then-reject mismatch this
 * fixes. Only used when the browser gives no usable MIME type.
 */
const EXTENSION_KINDS: Readonly<Record<string, DroppedMediaKind>> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
};

/** MIME types the browser could not resolve, so the extension must decide. */
function isUnresolvedMime(type: string): boolean {
  return type === "" || type === "application/octet-stream";
}

/** The supported media kind for a filename extension, or null. */
function extensionKind(filename: string): DroppedMediaKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSION_KINDS[filename.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * The media kind a dropped file should upload as, or `null` to ignore it.
 *
 * Prefers the browser's MIME type (`image/*`, `video/*`). When the agent
 * supplied no usable type (empty or `application/octet-stream`), falls back to
 * the filename extension — but ONLY the extensions the upload pipeline already
 * supports, so the graph never accepts a drop the server would reject.
 */
export function classifyDroppedMedia(file: File): DroppedMediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (isUnresolvedMime(file.type)) return extensionKind(file.name);
  return null;
}
