import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  CloudinaryUploadError,
  hasCloudinaryConfig,
  uploadCloudinaryMedia,
} from "@/lib/cloudinary-media-store";
import { CLOUDINARY_PROVIDER_ID } from "@/lib/assets/cloudinary-provider";
import {
  createThumbnailPathname,
  getMediaContentType,
  sanitizeStoragePathname,
  toMediaUrl,
  uploadMedia,
} from "@/lib/firebase-media-store";
import { fixtureStoreEnabled } from "@/lib/fixture-timeline-store";
import { writeOfflineMedia } from "@/lib/offline-media-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  ProjectAssetScopeError,
  requireProjectAssetScope,
} from "@/lib/project-asset-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hard ceiling on one uploaded part. The whole file is read into a Buffer, so
 * without this a single request could size the function's memory. Platform
 * body limits usually bite first; this makes the bound explicit and the
 * failure a 413 the client can explain rather than an OOM.
 */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Thumbnails are generated client-side from a single frame. */
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

/**
 * The only content types this route will store, by EXTENSION.
 *
 * The stored object's `Content-Type` used to come from `file.type` — the
 * client's declaration — which `/api/timeline-media` then replays on a
 * same-origin response. With no `nosniff` that was a stored-XSS shape; with
 * nosniff it is still a lie the app has no reason to repeat. The extension is
 * what the storage path is built from and what the allowlist can be checked
 * against, so it decides.
 */
const UPLOAD_CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["mov", "video/quicktime"],
]);

function allowedContentType(filename: string): string | null {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return UPLOAD_CONTENT_TYPES.get(extension) ?? null;
}

/** `FormDataEntryValue` is `File | string`. Reading one as a Blob without
 *  checking turned a client that sent a text field into a 500 from
 *  `file.arrayBuffer()` rather than the 400 it is. */
function readBlob(form: FormData, key: string): Blob | null {
  const value = form.get(key);
  return value instanceof Blob ? value : null;
}

function readText(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isImagePathname(pathname: string) {
  return /\.(jpe?g|png|webp)$/i.test(pathname);
}

function isVideoUpload(pathname: string, contentType: string) {
  return contentType.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(pathname);
}

function getUploadPathname(filename: string, contentType: string) {
  const isImage = contentType.startsWith("image/") || isImagePathname(filename);
  const sanitized = sanitizeStoragePathname(
    filename,
    isImage ? "timeline-thumbnails" : "timeline-videos",
  );

  if (!isImage || sanitized.startsWith("timeline-thumbnails/")) return sanitized;

  const basename = sanitized.split("/").pop() || `thumbnail-${Date.now()}.jpg`;
  return `timeline-thumbnails/${basename}`;
}

function storageFolderSegments(folderPath: string | null) {
  const segments = (folderPath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Asset folder paths cannot contain relative segments.");
  }
  return segments.map((segment) => segment.replace(/[^a-zA-Z0-9_.,@-]/g, "-"));
}

function scopeStoragePathname(
  pathname: string,
  uid: string,
  projectId: string,
  folderPath: string | null = null,
) {
  const [prefix, ...segments] = pathname.split("/");
  return [
    prefix,
    "projects",
    uid,
    projectId,
    ...storageFolderSegments(folderPath),
    ...segments,
  ].join("/");
}

function uniqueStoragePathname(pathname: string) {
  const slash = pathname.lastIndexOf("/");
  const prefix = slash === -1 ? "" : pathname.slice(0, slash + 1);
  const filename = slash === -1 ? pathname : pathname.slice(slash + 1);
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  return `${prefix}${stem}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
}

export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const file = readBlob(formData, "file");
    const filename = readText(formData, "filename");
    const thumbnailFile = readBlob(formData, "thumbnail");
    const thumbnailFilename = readText(formData, "thumbnailFilename");
    const projectId = await requireProjectAssetScope(formData.get("projectId"), user.uid);

    if (!file || !filename) {
      return NextResponse.json({ error: "Missing file or filename." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Files are limited to ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` },
        { status: 413 },
      );
    }
    if (thumbnailFile && thumbnailFile.size > MAX_THUMBNAIL_BYTES) {
      return NextResponse.json({ error: "Generated thumbnail is too large." }, { status: 413 });
    }

    // Derived from the extension and checked against the allowlist, NOT taken
    // from the client's `file.type`.
    const contentType = allowedContentType(filename);
    if (contentType === null) {
      return NextResponse.json(
        { error: `Unsupported file type: ${filename.split(".").pop() ?? filename}.` },
        { status: 415 },
      );
    }
    const mediaBuffer = Buffer.from(await file.arrayBuffer());
    const folderPath = readText(formData, "folderPath");

    // OFFLINE MODE FIRST, ahead of Cloudinary.
    //
    // Without this branch, uploading with GSTUDIO_FIXTURE_TIMELINES set reached
    // real Cloudinary: offline mode intercepted the timeline store and nothing
    // else, so the one part of an upload that leaves the machine was never
    // covered. Ahead of the Cloudinary check rather than after it because
    // `hasCloudinaryConfig()` is true whenever the env is present — which it is,
    // on the machine doing the offline testing.
    //
    // Same response shape as the other two, carrying a URL. Nothing downstream
    // learns where the bytes went.
    if (fixtureStoreEnabled()) {
      const pathname = scopeStoragePathname(
        uniqueStoragePathname(getUploadPathname(filename, contentType)),
        user.uid,
        projectId,
        folderPath,
      );
      // The same rule the Firebase path enforces: a video with no thumbnail has
      // nothing to draw on its card, and the client already generates one.
      if (isVideoUpload(pathname, contentType) && !thumbnailFile) {
        return NextResponse.json(
          { error: "Video uploads require a generated thumbnail." },
          { status: 400 },
        );
      }

      const storedMedia = writeOfflineMedia(pathname, mediaBuffer);

      let offlineThumbnail: { pathname: string; url: string } | undefined;
      if (thumbnailFile) {
        const thumbPathname = scopeStoragePathname(
          uniqueStoragePathname(
            thumbnailFilename
              ? sanitizeStoragePathname(thumbnailFilename, "timeline-thumbnails")
              : createThumbnailPathname(pathname),
          ),
          user.uid,
          projectId,
          folderPath,
        );
        offlineThumbnail = writeOfflineMedia(
          thumbPathname,
          Buffer.from(await thumbnailFile.arrayBuffer()),
        );
      }

      return NextResponse.json({
        pathname: storedMedia.pathname,
        url: storedMedia.url,
        thumbnailPathname: offlineThumbnail?.pathname,
        thumbnailUrl: offlineThumbnail?.url,
        width: storedMedia.width,
        height: storedMedia.height,
      });
    }

    if (hasCloudinaryConfig()) {
      const storedMedia = await uploadCloudinaryMedia(
        filename,
        mediaBuffer,
        contentType,
        user.uid,
        projectId,
        folderPath || undefined,
      );

      return NextResponse.json({
        pathname: storedMedia.pathname,
        url: storedMedia.url,
        thumbnailPathname: storedMedia.thumbnailPathname,
        thumbnailUrl: storedMedia.thumbnailUrl,
        providerId: CLOUDINARY_PROVIDER_ID,
        assetId: storedMedia.pathname,
      });
    }

    const pathname = scopeStoragePathname(
      uniqueStoragePathname(getUploadPathname(filename, contentType)),
      user.uid,
      projectId,
      folderPath,
    );
    const requiresThumbnail = isVideoUpload(pathname, contentType);

    if (requiresThumbnail && !thumbnailFile) {
      return NextResponse.json(
        { error: "Video uploads require a generated thumbnail." },
        { status: 400 },
      );
    }

    let thumbnailPathname: string | undefined;
    let thumbnailUrl: string | undefined;

    if (thumbnailFile && requiresThumbnail) {
      thumbnailPathname = thumbnailFilename
        ? scopeStoragePathname(
            uniqueStoragePathname(
              sanitizeStoragePathname(thumbnailFilename, "timeline-thumbnails"),
            ),
            user.uid,
            projectId,
            folderPath,
          )
        : scopeStoragePathname(
            uniqueStoragePathname(createThumbnailPathname(pathname)),
            user.uid,
            projectId,
            folderPath,
          );
      await uploadMedia(
        thumbnailPathname,
        Buffer.from(await thumbnailFile.arrayBuffer()),
        // Same rule as the media part: the extension decides, never the
        // client's declaration. Thumbnails are always JPEG unless the
        // filename says otherwise and the allowlist agrees.
        (thumbnailFilename && allowedContentType(thumbnailFilename)) || "image/jpeg",
      );
      thumbnailUrl = toMediaUrl(thumbnailPathname);
    }

    const storedMedia = await uploadMedia(
      pathname,
      mediaBuffer,
      contentType,
    );

    return NextResponse.json({
      pathname: storedMedia.pathname,
      url: storedMedia.url,
      thumbnailPathname,
      thumbnailUrl,
      // The source's real pixel size, so the client can mint a clip's `aspect`
      // from it rather than assuming 16:9. Absent for audio.
      width: storedMedia.width,
      height: storedMedia.height,
    });
  } catch (error) {
    if (error instanceof ProjectAssetScopeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CloudinaryUploadError) {
      console.error("[GSTUDIO_CLOUDINARY_UPLOAD_ERROR]", error);
      return NextResponse.json(
        { error: error.message },
        { status: error.status === 413 ? 413 : 502 },
      );
    }
    console.error("[GSTUDIO_MEDIA_UPLOAD_ERROR]", error);
    const message =
      error instanceof Error ? error.message : "Unable to upload file to hosted media storage.";
    const status = message.includes("Firebase Storage bucket not found") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
