import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";
import { serveTimelineClosure } from "@/lib/serve-timeline";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";
import { clientFacingStorageMessage } from "@/lib/firestore-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A timeline and EVERY document under it, in one answer.
 *
 * The last step of the read-volume work (#437). Batching the client's reads
 * took a 151-document board from 58 requests / ~430 document reads to 19 / 237,
 * and could go no further: the remaining waste is subtree walks repeated ACROSS
 * batches, which nothing on the client can dedupe. This removes the repetition
 * instead of deduplicating it — the server already loads the whole closure to
 * serve the root (see `serveTimelineClosure`), so handing all of it back means
 * the client never asks per card at all.
 *
 * NOT a replacement for the per-document reads. It primes; the ordinary
 * `ensure` path still exists for everything afterwards — a document edited in
 * another tab, a collection drilled into later, a closure too large to walk.
 * This is the opening move, not the only one.
 *
 * A POST for symmetry with `batch-get` and because it is emphatically not
 * cacheable, not because it writes anything. It writes nothing.
 */
export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) {
      return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJsonObject(request);
    const id = body.id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "A valid timeline id is required." }, { status: 400 });
    }
    // User-scoped ids embed their owner; a mismatch is a plain not-found so ids
    // cannot be probed for existence.
    if (checkUserScopedId(id, user.uid) === false) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const closure = await serveTimelineClosure(id, user.uid);
    // Null covers BOTH "no such document" and "the closure is too large to
    // walk". The client's fallback is the same either way — hydrate document by
    // document, as it did before this existed — so the two do not need
    // distinguishing here, and a 404 is the honest answer for the first.
    if (!closure) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    return NextResponse.json({
      results: Object.entries(closure.documents).map(([documentId, served]) => ({
        id: documentId,
        document: served.document,
        revision: served.revision,
      })),
      missing: closure.missing,
    });
  } catch (error) {
    if (error instanceof TimelineAccessDeniedError) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }
    console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
    return NextResponse.json(
      { error: clientFacingStorageMessage(error, "Unable to load the timeline documents.") },
      { status: 500 },
    );
  }
}
