import { NextResponse } from "next/server";

import type { TimelineDocument, TimelineClip } from "@storyboard/timeline-model/types";
import {
  getFirebaseTimelineDocument,
  saveFirebaseTimelineEntry,
  deleteFirebaseTimelineDocument,
} from "@/lib/firebase-timeline-store";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  getFolderPathFromTimelineId,
  isStoredTimelineDocument,
  isUnsavedProjectPlaceholder,
} from "@storyboard/timeline-model";
// Demo-content seed for the GET fallback — deliberately still the UI
// package's fixture set, not model logic.
import { getTimelineDocument } from "@storyboard/ui/timeline/timeline-documents";
import { CLOUDINARY_PROVIDER_ID } from "@/lib/assets/cloudinary-provider";
import { buildAssetLibraryClips } from "@/lib/assets/asset-library-timeline";
import { assetProviders } from "@/lib/assets/registry";
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

      const title = id.startsWith("asset-library-col-") ? "New Collection" : "Cloudinary Assets";
      const doc: TimelineDocument = firebaseDocument || { id, title, clips: [] };

      // The bespoke Cloudinary listing + hand-rolled folder detection this
      // branch used to do now lives behind the provider seam (phase 5): ask
      // the Cloudinary provider for this folder's page — the SAME
      // folder-scoping the graph palette uses — and shape it into the
      // media-strip's synthetic-timeline clips. Pinned to Cloudinary because
      // the asset-library ids embed Cloudinary folder paths; the drawer is
      // Cloudinary's, not a generic provider surface.
      const folderPath = getFolderPathFromTimelineId(id, user.uid);
      const folderSegments = folderPath === "" ? [] : folderPath.split("/");
      const provider = assetProviders.get(CLOUDINARY_PROVIDER_ID);
      if (!provider) {
        return NextResponse.json({ error: "Asset provider unavailable." }, { status: 500 });
      }
      const page = await provider.list({ uid: user.uid }, { folder: folderSegments });

      return NextResponse.json({
        document: {
          ...doc,
          clips: buildAssetLibraryClips(page, user.uid, doc.clips),
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

