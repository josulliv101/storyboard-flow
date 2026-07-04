import { NextResponse } from "next/server";

import type { TimelineDocument, TimelineClip } from "@storyboard/ui/timeline/types";
import {
  getFirebaseTimelineDocument,
  saveFirebaseTimelineDocument,
  deleteFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  getTimelineDocument,
  decodeFolderPath,
  getFolderPathFromTimelineId,
  encodeFolderPath,
  isUnsavedProjectPlaceholder,
} from "@storyboard/ui/timeline/timeline-documents";
import { listCloudinaryAssets } from "@/lib/cloudinary-media-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function storageErrorResponse(error: unknown, fallback: string) {
  const message =
    error instanceof Error &&
    (error.message.startsWith("Firebase Storage is not configured") ||
      error.message.includes("timed out"))
      ? error.message
      : fallback;

  console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<TimelineDocument>;

  return (
    typeof document.id === "string" &&
    typeof document.title === "string" &&
    Array.isArray(document.clips)
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (id.startsWith("trash-")) {
      const firebaseDocument = await getFirebaseTimelineDocument(id);
      const doc: TimelineDocument = firebaseDocument || {
        id,
        title: "Trash Bin",
        clips: [],
      };
      return NextResponse.json({ document: doc });
    }

    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    if (id.startsWith("asset-library-")) {
      const firebaseDocument = await getFirebaseTimelineDocument(id);

      let title = "Cloudinary Assets";
      if (id.startsWith("asset-library-col-")) {
        title = "New Collection";
      }

      const doc: TimelineDocument = firebaseDocument || {
        id,
        title,
        clips: [],
      };

      // 1. Fetch Cloudinary assets
      const cloudinaryAssets = await listCloudinaryAssets(user.uid);
      const folderPath = getFolderPathFromTimelineId(id, user.uid);

      // Detect subfolders under the current folderPath
      const detectedSubfolders = new Set<string>();
      cloudinaryAssets.forEach((asset) => {
        const path = asset.relativePath || asset.pathname;
        const parts = path.split("/").filter(Boolean);
        parts.pop(); // remove file name
        const assetFolder = parts.join("/");

        if (folderPath === "") {
          if (parts.length > 0) {
            detectedSubfolders.add(parts[0]);
          }
        } else {
          if (
            assetFolder.startsWith(folderPath + "/") &&
            parts.length > folderPath.split("/").length
          ) {
            const childPath = parts.slice(0, folderPath.split("/").length + 1).join("/");
            detectedSubfolders.add(childPath);
          }
        }
      });

      // 2. Filter Cloudinary assets in this folder
      const assetsInFolder = cloudinaryAssets.filter((asset) => {
        const path = asset.relativePath || asset.pathname;
        const parts = path.split("/").filter(Boolean);
        parts.pop(); // remove file name
        const assetFolder = parts.join("/");
        return assetFolder === folderPath;
      });

      const allActiveUrls = new Set(cloudinaryAssets.map((a) => a.url));

      // 3. Keep existing collections and valid media clips
      let merged = doc.clips.filter((clip) => {
        if (clip.kind === "collection") return true;
        return allActiveUrls.has(clip.src);
      });

      // Inject dynamically detected Cloudinary subfolders as collections
      detectedSubfolders.forEach((subfolderPath) => {
        const childId = `asset-library-col-${user.uid}-${encodeFolderPath(subfolderPath)}`;
        const exists = merged.some(
          (clip) => clip.kind === "collection" && clip.childTimelineId === childId
        );
        if (!exists) {
          const folderName = subfolderPath.split("/").pop() || "Folder";
          const uniqueId = `dynamic-col-${encodeFolderPath(subfolderPath)}`;
          merged.push({
            id: uniqueId,
            index: merged.length,
            kind: "collection",
            title: folderName,
            childTimelineId: childId,
            itemCount: 0,
            duration: 3,
            sourceDuration: 3,
            trimIn: 0,
            trimOut: 0,
            alt: folderName,
            aspect: 16 / 9,
            trackIndex: 0,
            startTime: 0,
          });
        }
      });

      // 4. Add new assets
      assetsInFolder.forEach((asset) => {
        const exists = merged.some(
          (clip) => clip.kind !== "collection" && clip.src === asset.url
        );
        if (!exists) {
          const name = asset.relativePath?.split("/").pop()?.replace(/\.[^/.]+$/, "") || "Asset";
          const aspect =
            asset.width && asset.height && asset.height > 0
              ? asset.width / asset.height
              : 16 / 9;
          const duration = asset.resourceType === "video" ? 6 : 4;
          const stableId = `asset-${asset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

          const newClip: TimelineClip =
            asset.resourceType === "video"
              ? {
                  id: stableId,
                  index: merged.length,
                  kind: "video",
                  src: asset.url,
                  poster: asset.thumbnailUrl,
                  alt: name,
                  aspect,
                  trackIndex: 0,
                  startTime: 0,
                  duration,
                  sourceDuration: duration,
                  trimIn: 0,
                  trimOut: 0,
                }
              : {
                  id: stableId,
                  index: merged.length,
                  kind: "image",
                  src: asset.url,
                  alt: name,
                  aspect,
                  trackIndex: 0,
                  startTime: 0,
                  duration,
                  sourceDuration: duration,
                  trimIn: 0,
                  trimOut: 0,
                };

          merged.push(newClip);
        }
      });

      // 5. Reindex and pack clips
      let nextStartTime = 1;
      const packedClips = merged.map((clip, index) => {
        const packed = {
          ...clip,
          index,
          startTime: nextStartTime,
        };
        nextStartTime += packed.duration + 1;
        return packed;
      });

      return NextResponse.json({
        document: {
          ...doc,
          clips: packedClips,
        },
      });
    }

    const firebaseDocument = await getFirebaseTimelineDocument(id);
    if (firebaseDocument) {
      // Self-healing: Check if any clip has a Cloudinary URL that might have moved/renamed
      let hasChanges = false;
      const cloudinaryAssets = await listCloudinaryAssets(user.uid).catch(() => []);
      let healedDocument = firebaseDocument;
      if (cloudinaryAssets.length > 0) {
        const assetMap = new Map<string, typeof cloudinaryAssets[0]>();
        cloudinaryAssets.forEach((asset) => {
          const filename = asset.relativePath?.split("/").pop() || asset.pathname?.split("/").pop();
          if (filename) {
            assetMap.set(filename, asset);
          }
        });

        const healedClips = firebaseDocument.clips.map((clip) => {
          if (clip.kind === "video" || clip.kind === "image") {
            const filename = clip.src.split("/").pop()?.split("?")[0]?.replace(/\.[^/.]+$/, "");
            if (filename) {
              const matchedAsset = assetMap.get(filename);
              if (matchedAsset && clip.src !== matchedAsset.url) {
                hasChanges = true;
                return {
                  ...clip,
                  src: matchedAsset.url,
                  poster: clip.kind === "video" ? matchedAsset.thumbnailUrl : clip.poster,
                };
              }
            }
          }
          return clip;
        });
        healedDocument = {
          ...firebaseDocument,
          clips: healedClips,
        };

        if (hasChanges) {
          await saveFirebaseTimelineDocument(healedDocument).catch(() => {});
        }
      }

      return NextResponse.json({ document: healedDocument });
    }

    const fallbackDocument = getTimelineDocument(id);
    if (!fallbackDocument) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const savedDocument = await saveFirebaseTimelineDocument(fallbackDocument);
    return NextResponse.json({ document: savedDocument });
  } catch (error) {
    return storageErrorResponse(error, "Unable to load the timeline document.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { response } = await requireAuthUser();
    if (response) return response;

    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      document?: unknown;
    };

    if (!isTimelineDocument(body.document) || body.document.id !== id) {
      return NextResponse.json({ error: "A valid timeline document is required." }, { status: 400 });
    }

    if (isUnsavedProjectPlaceholder(body.document)) {
      return NextResponse.json(
        { error: "Refusing to save an unloaded project placeholder." },
        { status: 409 },
      );
    }

    const savedDocument = await saveFirebaseTimelineDocument(body.document);
    return NextResponse.json({ document: savedDocument });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Refusing to save an empty timeline")
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    return storageErrorResponse(error, "Unable to save the timeline document.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { response } = await requireAuthUser();
    if (response) return response;

    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    await deleteFirebaseTimelineDocument(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return storageErrorResponse(error, "Unable to delete the timeline document.");
  }
}

