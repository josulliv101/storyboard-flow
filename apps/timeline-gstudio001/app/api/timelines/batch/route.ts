import { NextResponse } from "next/server";

import { isStoredTimelineDocument, isUnsavedProjectPlaceholder } from "@storyboard/timeline-model";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";
import {
  saveFirebaseTimelineDocumentsAtomic,
  TimelineDuplicateOwnerError,
  TimelineOrphanError,
  TimelineRevisionConflictError,
  type TimelineBatchWrite,
} from "@/lib/firebase-timeline-store";
import { changeLogDocuments, recordChange } from "@/lib/change-log";
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

    const body = await readJsonObject(request);
    const requested = body.writes;
    if (!Array.isArray(requested) || requested.length === 0) {
      return NextResponse.json({ error: "A batch requires at least one write." }, { status: 400 });
    }
    if (requested.length > MAX_BATCH_WRITES) {
      return NextResponse.json(
        { error: `A batch is limited to ${MAX_BATCH_WRITES} writes.` },
        { status: 400 },
      );
    }

    const writes: TimelineBatchWrite[] = [];
    for (const entry of requested) {
      // Each element is untrusted too — an array of nulls used to throw on the
      // first property read, the same 500-for-a-400 as the body itself.
      const write = (typeof entry === "object" && entry !== null ? entry : {}) as {
        document?: unknown;
        expectedRevision?: unknown;
        allowEmptying?: unknown;
      };
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
      // Says the empty this write produces is DELIBERATE, exempting just this
      // document from the empty-over-non-empty guard in the store. Per-write,
      // like `expectedRevision` and unlike a batch-wide option: a cross-timeline
      // move empties its source and fills its target in one batch, and only the
      // source is asking. Without it on the wire the app could never remove a
      // collection's last clip, however the client asked.
      if (write.allowEmptying !== undefined && typeof write.allowEmptying !== "boolean") {
        return NextResponse.json(
          { error: "allowEmptying must be a boolean." },
          { status: 400 },
        );
      }
      writes.push({
        document: write.document,
        ...(write.expectedRevision !== undefined
          ? { expectedRevision: write.expectedRevision }
          : {}),
        ...(write.allowEmptying === true ? { allowEmptying: true } : {}),
      });
    }

    const results = await saveFirebaseTimelineDocumentsAtomic(writes, user.uid);
    // After the commit, never inside it — the log must not be able to fail a
    // save, and must not claim a change that did not land.
    await recordChange({
      uid: user.uid,
      source: "app",
      documents: changeLogDocuments(
        results,
        Object.fromEntries(writes.map((write) => [write.document.id, write.document])),
        Object.fromEntries(writes.map((write) => [write.document.id, write.expectedRevision])),
      ),
    });
    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof TimelineRevisionConflictError) {
      return NextResponse.json(
        { error: error.message, conflicts: error.conflicts },
        { status: 409 },
      );
    }
    // A write that would strand a collection. 409 like the other refusals the
    // client already knows how to back off from, and NOT lumped in with the
    // conflict branch: it carries no `conflicts` array, so the gateway's
    // conflict handling (reload the named ids) would have nothing to act on.
    if (error instanceof TimelineOrphanError) {
      return NextResponse.json(
        { error: error.message, orphans: error.orphans },
        { status: 409 },
      );
    }
    // A write that would give a collection a second owning placement. 409 for
    // the same reason as the orphan refusal beside it, and with its own array
    // rather than `conflicts` — there is nothing to reload and retry here; the
    // write is malformed, not stale.
    if (error instanceof TimelineDuplicateOwnerError) {
      return NextResponse.json(
        { error: error.message, duplicates: error.duplicates },
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
