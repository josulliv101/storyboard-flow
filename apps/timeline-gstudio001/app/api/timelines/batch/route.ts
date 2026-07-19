import { NextResponse } from "next/server";

import { isStoredTimelineDocument, isUnsavedProjectPlaceholder } from "@storyboard/timeline-model";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import {
  saveFirebaseTimelineDocumentsAtomic,
  TimelineRevisionConflictError,
  type TimelineBatchWrite,
} from "@/lib/firebase-timeline-store";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One graph change can touch a handful of documents (a cross-timeline move
// touches two, plus a trash drop). Far below Firestore's transaction limit;
// anything larger than this is a malformed client.
const MAX_BATCH_WRITES = 25;

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * ALL-OR-NOTHING multi-document writes: the batch twin of PATCH
 * /api/timelines/[id], for changes that span documents (cross-timeline
 * moves, trash drops) where independent PATCHes could persist half a
 * change. Each write may carry `expectedRevision` (from the GET that read
 * the document): any mismatch rejects the WHOLE batch with 409 and the
 * conflicted ids' actual revisions — nothing is written, and a stale
 * client can't silently overwrite a newer writer. Writes without an
 * expectation keep last-write-wins (legacy semantics).
 */
export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      writes?: { document?: unknown; expectedRevision?: unknown }[];
    };
    if (!Array.isArray(body.writes) || body.writes.length === 0) {
      return NextResponse.json({ error: "A batch requires at least one write." }, { status: 400 });
    }
    if (body.writes.length > MAX_BATCH_WRITES) {
      return NextResponse.json(
        { error: `A batch is limited to ${MAX_BATCH_WRITES} writes.` },
        { status: 400 },
      );
    }

    const writes: TimelineBatchWrite[] = [];
    for (const write of body.writes) {
      // Full runtime validation (every clip, discriminated by kind): a
      // malformed client payload must never persist under a TimelineClip
      // assertion — it would break hydration and packing at read time.
      if (!isStoredTimelineDocument(write.document)) {
        return NextResponse.json(
          { error: "Every batch write needs a valid timeline document." },
          { status: 400 },
        );
      }
      if (!isValidTimelineId(write.document.id)) {
        return NextResponse.json({ error: "Invalid timeline id." }, { status: 400 });
      }
      // User-scoped ids (trash-<uid>, asset-library-<uid>…) embed their
      // owner: a mismatch is rejected before any storage read, as a plain
      // not-found (no existence oracle).
      if (checkUserScopedId(write.document.id, user.uid) === false) {
        return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
      }
      if (isUnsavedProjectPlaceholder(write.document)) {
        return NextResponse.json(
          { error: "Refusing to save an unloaded project placeholder." },
          { status: 409 },
        );
      }
      if (
        write.expectedRevision !== undefined &&
        (typeof write.expectedRevision !== "number" ||
          !Number.isInteger(write.expectedRevision) ||
          write.expectedRevision < 0)
      ) {
        return NextResponse.json(
          { error: "expectedRevision must be a non-negative integer." },
          { status: 400 },
        );
      }
      writes.push({
        document: write.document,
        ...(write.expectedRevision !== undefined
          ? { expectedRevision: write.expectedRevision }
          : {}),
      });
    }

    const results = await saveFirebaseTimelineDocumentsAtomic(writes, user.uid);
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof TimelineRevisionConflictError) {
      return NextResponse.json(
        { error: error.message, conflicts: error.conflicts },
        { status: 409 },
      );
    }
    // Someone else's document: a plain not-found, so timeline ids can't be
    // probed for existence.
    if (error instanceof TimelineAccessDeniedError) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("Refusing to save an empty timeline") ||
        error.message.startsWith("A batch write must not repeat"))
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error &&
      (error.message.startsWith("Firebase Storage is not configured") ||
        error.message.includes("timed out"))
        ? error.message
        : "Unable to save the timeline documents.";

    console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
