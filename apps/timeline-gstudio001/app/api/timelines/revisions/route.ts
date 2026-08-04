import { NextResponse } from "next/server";

import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readStoredTimelineEntry } from "@/lib/firebase-timeline-store";
import { TimelineAccessDeniedError } from "@/lib/timeline-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The CHEAP half of live updates: "have any of these documents changed?".
//
// The open board polls this and compares against its own revision ledger; a
// higher number is the signal to pull the document and splice in what is new.
// It exists because a write can now come from somewhere this tab cannot hear —
// the remote MCP endpoint (an agent uploading a render) or another tab — and
// the client has no Firestore listener to learn about it. See
// components/graph-view/graph-remote-changes.tsx.
//
// Deliberately returns ONLY revisions, never content: it runs on a timer, so
// keeping it small is the whole point. The document fetch happens once, after
// this says something actually moved.

/** Bound the fan-out — one poll should never turn into an unbounded read. */
const MAX_IDS = 24;

export async function GET(request: Request) {
  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ revisions: {} });
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Too many ids — ${MAX_IDS} at most.` },
      { status: 400 },
    );
  }

  const revisions: Record<string, number> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const entry = await readStoredTimelineEntry(id, user.uid);
        // A missing or refused document is simply OMITTED rather than reported
        // as absent — a poller has no business learning which ids exist under
        // another account, and the client only acts on numbers it recognises.
        if (entry) revisions[id] = entry.revision;
      } catch (error) {
        if (error instanceof TimelineAccessDeniedError) return;
        throw error;
      }
    }),
  );

  return NextResponse.json(
    { revisions },
    // Never let a CDN or the browser serve a stale answer to a change poll.
    { headers: { "Cache-Control": "no-store" } },
  );
}
