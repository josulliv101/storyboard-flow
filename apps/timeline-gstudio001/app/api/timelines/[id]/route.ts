import { NextResponse } from "next/server";

import type { TimelineDocument, TimelineClip } from "@storyboard/timeline-model/types";
import {
  getFirebaseTimelineDocument,
  saveFirebaseTimelineEntry,
  deleteFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  decodeFolderPath,
  encodeFolderPath,
  getFolderPathFromTimelineId,
  isStoredTimelineDocument,
  isUnsavedProjectPlaceholder,
} from "@storyboard/timeline-model";
// Demo-content seed for the GET fallback — deliberately still the UI
// package's fixture set, not model logic.
import { getTimelineDocument } from "@storyboard/ui/timeline/timeline-documents";
import { CLOUDINARY_PROVIDER_ID } from "@/lib/assets/cloudinary-provider";
import { listCloudinaryAssets } from "@/lib/cloudinary-media-store";
import { serveTimelineDocument, serveTrashDocument } from "@/lib/serve-timeline";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** User-scoped ids (trash-<uid>, asset-library-<uid>…) embed their owner:
 *  a mismatch is rejected before any storage read. Returns null when the id
 *  is fine (not scoped, or scoped to the requester). */
function scopedIdMismatch(id: string, uid: string) {
  return checkUserScopedId(id, uid) === false
    ? NextResponse.json({ error: "Timeline was not found." }, { status: 404 })
    : null;
}

function storageErrorResponse(error: unknown, fallback: string) {
  // Someone else's document: a plain not-found, so timeline ids can't be
  // probed for existence.
  if (error instanceof TimelineAccessDeniedError) {
    return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
  }
  const message =
    error instanceof Error &&
    (error.message.startsWith("Firebase Storage is not configured") ||
      error.message.includes("timed out"))
      ? error.message
      : fallback;

  console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const mismatch = scopedIdMismatch(id, user.uid);
    if (mismatch) return mismatch;

    if (id.startsWith("trash-")) {
      const trash = await serveTrashDocument(id, user.uid);
      return NextResponse.json({ document: trash.document, revision: trash.revision });
    }

    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }

    if (id.startsWith("asset-library-")) {
      const firebaseDocument = await getFirebaseTimelineDocument(id, user.uid);

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
          const duration = asset.resourceType === "video" ? (asset.duration ?? 6) : 4;
          const stableId = `asset-${asset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

          // Provenance travels with the clip from the moment it is minted
          // (`sourceAsset` on the stored model): `src` is how it renders,
          // this is which provider file it IS.
          const sourceAsset = { providerId: CLOUDINARY_PROVIDER_ID, assetId: asset.id };
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
                  sourceAsset,
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
                  sourceAsset,
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

    // Heal + read-time summary derivation live in lib/serve-timeline — the
    // ONE serve path this route shares with the RSC payload loaders.
    const served = await serveTimelineDocument(id, user.uid);
    if (served) {
      return NextResponse.json({ document: served.document, revision: served.revision });
    }

    const fallbackDocument = getTimelineDocument(id);
    if (!fallbackDocument) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const saved = await saveFirebaseTimelineEntry(fallbackDocument, user.uid);
    return NextResponse.json({ document: saved.document, revision: saved.revision });
  } catch (error) {
    return storageErrorResponse(error, "Unable to load the timeline document.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }
    const mismatch = scopedIdMismatch(id, user.uid);
    if (mismatch) return mismatch;

    const body = (await request.json().catch(() => ({}))) as {
      document?: unknown;
    };

    // Full runtime validation (every clip, discriminated by kind) — the
    // same guard the batch endpoint uses; a malformed payload must never
    // persist under a TimelineClip assertion.
    if (!isStoredTimelineDocument(body.document) || body.document.id !== id) {
      return NextResponse.json({ error: "A valid timeline document is required." }, { status: 400 });
    }

    if (isUnsavedProjectPlaceholder(body.document)) {
      return NextResponse.json(
        { error: "Refusing to save an unloaded project placeholder." },
        { status: 409 },
      );
    }

    // No expected revision on the single-document path: legacy views keep
    // last-write-wins. The response still carries the stamped revision so
    // any caller can start carrying expectations (the batch endpoint is the
    // compare-and-set path).
    const saved = await saveFirebaseTimelineEntry(body.document, user.uid);
    return NextResponse.json({ document: saved.document, revision: saved.revision });
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
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    if (!isValidTimelineId(id)) {
      return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
    }
    const mismatch = scopedIdMismatch(id, user.uid);
    if (mismatch) return mismatch;

    await deleteFirebaseTimelineDocument(id, user.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    return storageErrorResponse(error, "Unable to delete the timeline document.");
  }
}

