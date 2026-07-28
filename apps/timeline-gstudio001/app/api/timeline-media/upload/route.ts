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
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  ProjectAssetScopeError,
  requireProjectAssetScope,
} from "@/lib/project-asset-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const file = formData.get("file") as Blob | null;
    const filename = formData.get("filename") as string | null;
    const thumbnailFile = formData.get("thumbnail") as Blob | null;
    const thumbnailFilename = formData.get("thumbnailFilename") as string | null;
    const projectId = await requireProjectAssetScope(formData.get("projectId"), user.uid);

    if (!file || !filename) {
      return NextResponse.json({ error: "Missing file or filename." }, { status: 400 });
    }

    const contentType = getMediaContentType(filename, file.type);
    const mediaBuffer = Buffer.from(await file.arrayBuffer());
    const folderPath = formData.get("folderPath") as string | null;
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
        thumbnailFile.type || "image/jpeg",
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
