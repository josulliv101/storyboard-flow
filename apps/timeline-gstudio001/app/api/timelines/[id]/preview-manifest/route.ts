import { NextResponse } from "next/server";

import { compilePlaybackManifest } from "@storyboard/timeline-domain";
import { deriveClosureSummaries } from "@/lib/derive-collection-summaries";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readStoredTimelineEntry } from "@/lib/firebase-timeline-store";
import {
  loadTimelineClosure,
  TimelineClosureTooLargeError,
} from "@/lib/load-timeline-closure";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidTimelineId(id: string) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * The playback read model: this timeline's COMPLETE nested closure
 * flattened into absolute-time media leaves (see
 * timeline-domain/playback-manifest). Compiled from STORED documents — the
 * preview no longer depends on how much of the graph the session hydrated,
 * and duplicated clip ids across documents cannot break it. Unloadable
 * children degrade that branch to silence and are reported in `missing`.
 */
export async function GET(
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
    if (checkUserScopedId(id, user.uid) === false) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const entry = await readStoredTimelineEntry(id, user.uid);
    if (!entry) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    // The root was just read above (that read IS this route's 404 check), so
    // hand it straight to the walker rather than making it fetch the same
    // document again and then overwriting the result.
    const { documents, missing, revisions } = await loadTimelineClosure(id, user.uid, {
      rootEntry: entry,
    });

    // Stored collection summaries go stale by design: the graph view's
    // writes are patch-scoped, so editing a child never rewrites the
    // parents that reference it. Every other read path repairs that at read
    // time (serveTimelineDocument); compiling from the raw closure made this
    // route the one reader that did not, so the preview both reported a
    // different total than the board and windowed a grown child's newest
    // clips out of playback entirely.
    const summarized = deriveClosureSummaries(documents, new Set(missing));

    const manifest = compilePlaybackManifest(
      summarized,
      id,
      entry.revision,
      new Date().toISOString(),
      revisions,
    );
    return NextResponse.json({ manifest, missing });
  } catch (error) {
    // Someone else's document: a plain not-found, so timeline ids can't be
    // probed for existence.
    if (error instanceof TimelineAccessDeniedError) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith("Collection cycle detected")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // Too many documents to compile. 409 like the cycle case: the request is
    // fine, the stored structure is not, and retrying changes nothing.
    if (error instanceof TimelineClosureTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const message =
      error instanceof Error &&
      (error.message.startsWith("Firebase Storage is not configured") ||
        error.message.includes("timed out"))
        ? error.message
        : "Unable to compile the preview manifest.";

    console.error("[GSTUDIO_TIMELINE_STORAGE_ERROR]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
