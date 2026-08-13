import "server-only";

import { Readable } from "node:stream";

import { getFirebaseBucketByName, getFirebaseBucketNames } from "./firebase-admin";

export type StoredMedia = {
  pathname: string;
  url: string;
  bucketName?: string;
  contentType?: string;
  size?: number;
};

const ALLOWED_MEDIA_PREFIXES = [
  "timeline-videos/",
  "timeline-thumbnails/",
  "timeline-audio/",
] as const;

export function isAllowedMediaPathname(pathname: string | null): pathname is string {
  return !!pathname && ALLOWED_MEDIA_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function toMediaUrl(pathname: string) {
  return `/api/timeline-media?pathname=${encodeURIComponent(pathname)}`;
}

export function sanitizeStoragePathname(filename: string, fallbackPrefix = "timeline-videos") {
  const normalized = filename
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");

  const safeName = normalized || `upload-${Date.now()}`;
  // Reuses ALLOWED_MEDIA_PREFIXES rather than repeating it: the literal copy
  // that used to live here silently missed any prefix added to the list, and
  // the symptom is a DOUBLE-PREFIXED storage key, not an error.
  const prefixedName = isAllowedMediaPathname(safeName)
    ? safeName
    : `${fallbackPrefix}/${safeName}`;

  return prefixedName.replace(/[^a-zA-Z0-9/_.,@-]/g, "-");
}

export function getMediaContentType(pathname: string, explicitType?: string) {
  if (explicitType && explicitType !== "application/octet-stream") return explicitType;

  const lower = pathname.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  // Audio (#309). `.m4a` is an MP4 container, hence audio/mp4.
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".oga") || lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".opus")) return "audio/opus";
  return lower.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
}

export function createThumbnailPathname(videoPathname: string) {
  const filename = videoPathname.split("/").pop() || `video-${Date.now()}`;
  const baseName = filename.replace(/\.[^/.]+$/, "").slice(0, 90) || "video";
  return `timeline-thumbnails/${baseName}-thumbnail-${Date.now()}.jpg`;
}

function isMissingBucketError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return code === "404" || message.includes("bucket does not exist");
}

function createMissingBucketError(bucketNames: string[]) {
  return new Error(
    `Firebase Storage bucket not found. Checked: ${bucketNames.join(", ")}. ` +
      "Create/enable Firebase Storage for the project or set FIREBASE_STORAGE_BUCKET to the exact bucket shown in the Firebase console.",
  );
}

export async function uploadMedia(
  pathname: string,
  data: Buffer,
  contentType?: string,
): Promise<StoredMedia> {
  if (!isAllowedMediaPathname(pathname)) {
    throw new Error("Invalid Firebase Storage media path.");
  }

  const normalizedContentType = getMediaContentType(pathname, contentType);
  const bucketNames = getFirebaseBucketNames();

  for (const bucketName of bucketNames) {
    const file = getFirebaseBucketByName(bucketName).file(pathname);

    try {
      await file.save(data, {
        resumable: false,
        metadata: {
          contentType: normalizedContentType,
          // Thumbnails are content-addressed by a unique upload name, so the
          // long immutable lifetime is right — but `private`, not `public`:
          // these objects are only ever reachable through the authenticated
          // /api/timeline-media route, and `public` would authorize a shared
          // cache to serve one user's thumbnail to another on URL match alone.
          // The route re-asserts this on every response (see
          // `toPrivateCacheControl`) so objects predating this change are
          // covered too.
          cacheControl: pathname.startsWith("timeline-thumbnails/")
            ? "private, max-age=31536000, immutable"
            : "private, no-cache",
        },
      });

      return {
        pathname,
        url: toMediaUrl(pathname),
        bucketName,
        contentType: normalizedContentType,
        size: data.byteLength,
      };
    } catch (error) {
      if (!isMissingBucketError(error)) throw error;
    }
  }

  throw createMissingBucketError(bucketNames);
}

export async function getMediaMetadata(pathname: string) {
  if (!isAllowedMediaPathname(pathname)) return null;

  for (const bucketName of getFirebaseBucketNames()) {
    const file = getFirebaseBucketByName(bucketName).file(pathname);

    try {
      const [exists] = await file.exists();
      if (!exists) continue;

      const [metadata] = await file.getMetadata();
      return {
        bucketName,
        size: Number(metadata.size || 0),
        contentType: getMediaContentType(pathname, metadata.contentType),
        cacheControl:
          metadata.cacheControl ||
          (pathname.startsWith("timeline-thumbnails/")
            ? "public, max-age=31536000, immutable"
            : "private, no-cache"),
      };
    } catch (error) {
      if (!isMissingBucketError(error)) throw error;
    }
  }

  return null;
}

export function createMediaReadStream(
  pathname: string,
  range?: { start: number; end: number },
  // The first configured bucket. `?? ""` keeps the default total; an empty
  // name fails in the SDK with the bucket it was given, which is a clearer
  // error than a TypeError here.
  bucketName = getFirebaseBucketNames()[0] ?? "",
) {
  const file = getFirebaseBucketByName(bucketName).file(pathname);
  return range
    ? (Readable.toWeb(file.createReadStream({ start: range.start, end: range.end })) as BodyInit)
    : (Readable.toWeb(file.createReadStream()) as BodyInit);
}
