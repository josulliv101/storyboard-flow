import { NextResponse } from "next/server";

import { loadTimelineClosure, TimelineClosureTooLargeError } from "@/lib/load-timeline-closure";
import { requireAuthUser } from "@/lib/firebase-auth-session";
import { checkUserScopedId, TimelineAccessDeniedError } from "@/lib/timeline-ownership";
import { clientFacingStorageMessage } from "@/lib/firestore-failure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A project and everything under it, as a downloadable JSON file.
 *
 * THE FORMAT IS THE FIXTURE FORMAT — `{ projectId, documents }`, exactly what
 * `GSTUDIO_FIXTURE_TIMELINES` reads and what `scripts/make-scale-probe.mjs`
 * writes. That is the whole point rather than a convenience: an export is
 * directly loadable, so a project can leave Firestore and come back as an
 * offline board without a converter in between, and the file can be diffed
 * against a generated fixture because they are the same shape.
 *
 * STORED, NOT SERVED. This walks with `loadTimelineClosure`, which returns
 * documents as written, and deliberately not `serveTimelineClosure`, which
 * recomputes each collection clip's `itemCount`, `previewItems` and `duration`
 * bottom-up for display.
 *
 * To be precise about what that does and does not mean, because the exported
 * file shows it plainly: those summary fields ARE in the output, because they
 * are denormalized onto the parent at write time and so are genuinely part of
 * the stored clip. What raw avoids is not their presence but their
 * RECOMPUTATION — a served export would freeze one moment's derived view into a
 * file that outlives it, and re-importing that would restore summaries as
 * authoritative that the app only ever treats as a cache. Exporting what is
 * stored round-trips to the same bytes; exporting what is served does not.
 *
 * ── IT EXPORTS WHATEVER THE STORE IS SERVING ───────────────────────────────
 *
 * The walk goes through the same read seam as everything else, so with
 * `GSTUDIO_FIXTURE_TIMELINES` set this exports the FIXTURE, not Firestore —
 * offline mode intercepts before the network. That is the correct behaviour
 * (it is how an offline board can be re-exported after editing) and it is a
 * trap worth naming: exporting a real project requires offline mode to be OFF.
 *
 * Costs ONE read per collection, once — the same walk the board already does to
 * open the project, which is the floor for "every document under this root".
 * Media clips ride along inside their parent's `clips` array and cost nothing.
 * In offline mode it costs nothing at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, response } = await requireAuthUser();
    if (response || !user) {
      return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "A valid timeline id is required." }, { status: 400 });
    }
    // User-scoped ids embed their owner; a mismatch is a plain not-found so ids
    // cannot be probed for existence. Ownership of everything BELOW the root is
    // enforced per document by the reader the walk uses.
    if (checkUserScopedId(id, user.uid) === false) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const closure = await loadTimelineClosure(id, user.uid);

    // A missing ROOT is a 404, not an empty file. The walk substitutes an empty
    // document for anything it cannot load and reports it in `missing`, so the
    // root appearing there is the one case that means "no such project" rather
    // than "one branch is dangling".
    if (closure.missing.includes(id)) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }

    const root = closure.documents[id];
    const documents: Record<string, unknown> = {};
    for (const [documentId, document] of Object.entries(closure.documents)) {
      // Dangling branches are dropped rather than exported as empty documents.
      // Re-importing a placeholder would MINT the missing document as a real
      // empty collection, quietly converting a broken reference into a
      // legitimate-looking empty one — the import would look like it healed
      // something when it had only forgotten what was wrong.
      if (closure.missing.includes(documentId)) continue;
      documents[documentId] = {
        ...document,
        // `isProject` lives on the Firestore RECORD, not on the document, so the
        // walk cannot carry it. Without it `fixtureListProjects` finds no
        // project and the imported board has nothing to open.
        ...(documentId === id ? { isProject: true } : {}),
      };
    }

    // A filename someone can find later. The title is the useful part, and
    // anything outside a conservative set becomes `-` rather than being
    // percent-escaped: this lands in a Content-Disposition header, where a
    // stray quote or newline is a header-injection question nobody should have
    // to think about while exporting a project.
    const slug =
      (root?.title ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || id;

    return new NextResponse(
      JSON.stringify({ projectId: id, documents }, null, 2),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${slug}.json"`,
          // A project export is a point-in-time snapshot of mutable data.
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof TimelineAccessDeniedError) {
      return NextResponse.json({ error: "Timeline was not found." }, { status: 404 });
    }
    if (error instanceof TimelineClosureTooLargeError) {
      return NextResponse.json(
        { error: "This project reaches too many documents to export in one file." },
        { status: 413 },
      );
    }
    console.error("[GSTUDIO_TIMELINE_EXPORT_ERROR]", error);
    return NextResponse.json(
      { error: clientFacingStorageMessage(error, "Unable to export the project.") },
      { status: 500 },
    );
  }
}
