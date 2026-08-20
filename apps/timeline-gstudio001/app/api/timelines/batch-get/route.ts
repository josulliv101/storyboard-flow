import { NextResponse } from "next/server";

import type { TimelineDocument } from "@storyboard/timeline-model/types";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";
import { getTimelineDocument } from "@storyboard/ui/timeline/timeline-documents";
import {
  createTimelineEntryReader,
  BOARD_OPEN_MAX_DEPTH,
  serveTimelineDocument,
  serveTrashDocument,
} from "@/lib/serve-timeline";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";
import { clientFacingStorageMessage } from "@/lib/firestore-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read MANY timeline documents in one request.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Writes were batched from the start (`/api/timelines/batch`); reads were not.
 * The client's cache filled one document at a time — one `fetch` per id — and
 * every one of those requests ran `serveTimelineDocument`, which walks the
 * document's ENTIRE closure to derive collection previews bottom-up.
 *
 * So the cost was not N reads for N documents. It was N reads plus N subtree
 * walks, and the subtrees overlap almost completely: a project's children are
 * exactly the documents the client asks for next, each of which re-reads its
 * own descendants. Measured on a 151-document project (50 scenes x 2
 * sub-collections x 3 clips), ONE page load cost 58 HTTP requests and about
 * 430 document reads. Firestore's free tier allows 50,000 a day, which a day of
 * ordinary work then exhausts (#437).
 *
 * ── What actually fixes it ─────────────────────────────────────────────────
 *
 * ONE `createTimelineEntryReader` shared across every id in the batch. That
 * reader memoizes by id for the life of a request, so each underlying document
 * is read exactly once no matter how many of the requested closures contain it.
 * The machinery is not new — it was written for the RSC focus-path loader,
 * whose own comment describes this exact problem — it simply could never help
 * across N separate HTTP requests, because each one built its own reader.
 *
 * Same probe, after: 1 request, ~151 reads. The deeper the tree, the larger the
 * ratio.
 *
 * ── Per-document outcomes, not a batch verdict ─────────────────────────────
 *
 * Every id gets its OWN result, including its own failure. A batch that failed
 * whole because one id was somebody else's, or malformed, or missing, would be
 * strictly worse than the per-document GETs it replaces: one bad id in a
 * hydration burst would blank the board. The shapes below mirror what
 * `GET /api/timelines/[id]` returns for the same case, so the client can treat
 * a batch entry and a single fetch identically.
 *
 * A POST because the id list can be long — hundreds of ids do not belong in a
 * query string — and this is deliberately NOT cached: it reads live documents,
 * exactly as the GET it replaces does.
 */

/** Upper bound on one request. A hydration burst is tens of ids; anything past
 *  this is a caller bug, and refusing loudly beats a request that walks the
 *  whole database because a list was built wrong. */
const MAX_BATCH_IDS = 200;

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/** One document's outcome. `document` present means it loaded; `error` present
 *  means that id failed and the others did not. */
type BatchReadResult = Readonly<{
  id: string;
  document?: TimelineDocument;
  revision?: number;
  error?: string;
  /** The status the equivalent single GET would have returned, so the client
   *  can distinguish "not found" from "the database is unwell" without parsing
   *  a message. */
  status?: number;
}>;

export async function POST(request: Request) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) {
      return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJsonObject(request);
    const rawIds = body.ids;
    if (!Array.isArray(rawIds)) {
      return NextResponse.json({ error: "An `ids` array is required." }, { status: 400 });
    }
    // Deduplicated before anything is read: a repeated id in the request would
    // otherwise be served twice, which is the very cost this endpoint exists to
    // remove. The shared reader would absorb it, but not sending it is cheaper
    // than relying on that.
    const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string"))];
    if (ids.length > MAX_BATCH_IDS) {
      return NextResponse.json(
        { error: `A batch read is limited to ${MAX_BATCH_IDS} ids.` },
        { status: 400 },
      );
    }

    // THE WHOLE POINT: one reader, every id. See the note above.
    const read = createTimelineEntryReader(user.uid);

    const results = await Promise.all(
      ids.map(async (id): Promise<BatchReadResult> => {
        try {
          // User-scoped ids embed their owner; a mismatch is refused before any
          // read, and as a plain not-found so ids cannot be probed.
          if (checkUserScopedId(id, user.uid) === false) {
            return { id, error: "Timeline was not found.", status: 404 };
          }

          if (id.startsWith("trash-")) {
            const trash = await serveTrashDocument(id, user.uid, read);
            return { id, document: trash.document, revision: trash.revision };
          }

          if (!isValidTimelineId(id)) {
            return { id, error: "Invalid timeline id.", status: 400 };
          }

          const served = await serveTimelineDocument(id, user.uid, read, {
            maxDepth: BOARD_OPEN_MAX_DEPTH,
          });
          if (served) {
            return { id, document: served.document, revision: served.revision };
          }

          // The demo-content fallback, SERVED AND NOT PERSISTED — the same rule
          // and the same reason as the single GET: these fixture ids are short
          // and shared, and a read that saved one would hand a global name to
          // whoever asked first. `revision: 0` is a create token, so the
          // client's first real write still brings it into existence.
          const fallback = getTimelineDocument(id);
          if (!fallback) return { id, error: "Timeline was not found.", status: 404 };
          return { id, document: fallback, revision: 0 };
        } catch (error) {
          // Someone else's document reads as a plain not-found, so timeline ids
          // cannot be probed for existence.
          if (error instanceof TimelineAccessDeniedError) {
            return { id, error: "Timeline was not found.", status: 404 };
          }
          console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
          return {
            id,
            error: clientFacingStorageMessage(error, "Unable to load the timeline document."),
            status: 500,
          };
        }
      }),
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
    return NextResponse.json(
      { error: clientFacingStorageMessage(error, "Unable to load the timeline documents.") },
      { status: 500 },
    );
  }
}
