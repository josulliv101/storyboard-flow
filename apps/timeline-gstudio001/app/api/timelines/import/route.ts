import { writeFileSync } from "node:fs";
import { basename } from "node:path";

import { NextResponse } from "next/server";

import { isStoredTimelineDocument } from "@storyboard/timeline-model";

import { requireAuthUser } from "@/lib/firebase-auth-session";
import { readJsonObject } from "@/lib/read-json-body";
import {
  fixtureStoreEnabled,
  fixtureStoreIsGenerated,
  fixtureStorePath,
} from "@/lib/fixture-timeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Load a project from an exported JSON file — into the OFFLINE store, never
 * into Firestore.
 *
 * The other half of `GET /api/timelines/[id]/export`, and the reason that
 * export emits the fixture format. Together they are a save/load loop that
 * touches Firebase exactly once, at export: after that a project can be
 * reloaded, edited and reloaded again for nothing.
 *
 * ── Why this writes a FILE rather than the in-memory store ─────────────────
 *
 * The obvious implementation replaces the fixture store's in-memory Maps. This
 * writes the JSON to the path `GSTUDIO_FIXTURE_TIMELINES` points at instead,
 * and lets the existing loader notice. That is not a longer road to the same
 * place — `load()` stats the file on every read and rebuilds when the mtime
 * moves, so writing the file gets the reload for free AND the import survives a
 * server restart, which an in-memory swap would lose on the next Ctrl+C. It
 * also means the imported project IS a fixture file afterwards: committable,
 * diffable, and loadable by anything else that reads fixtures.
 *
 * ── What it refuses, and why each one ──────────────────────────────────────
 *
 * PRODUCTION, unconditionally. This writes to the filesystem and is gated on a
 * store that disables the ownership invariant; `fixtureStoreEnabled()` is
 * already false in production, and the explicit check here means that is stated
 * at the endpoint rather than inferred from a helper two files away.
 *
 * FIXTURE MODE OFF. With no fixture path configured there is nowhere to put the
 * file, and writing one would be inert until someone set the variable — an
 * import that reports success and changes nothing. A 409 explaining the setup
 * is the honest answer.
 *
 * THE GENERATED FIXTURES. `dev-timelines.json` is committed;
 * `scale-probe.json` is gitignored but reproducible from
 * `scripts/make-scale-probe.mjs` and is the baseline the read-volume
 * measurements are quoted against. Either way both are OWNED BY A GENERATOR,
 * and overwriting one with a project import would replace a reproducible
 * baseline with something only this machine has — silently, and discovered
 * later as a measurement that stopped matching. Point the variable at a scratch
 * file (`fixtures/local.json`) and this endpoint will happily overwrite that as
 * often as you like.
 *
 * A MALFORMED PAYLOAD, before touching the disk. Validation is not politeness
 * here: the file being written is the one the store reads on its next request,
 * so a bad write does not fail the import, it breaks the board — `load()` would
 * throw on parse or serve garbage, and the app would be unopenable until
 * someone worked out which file to repair by hand.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  const { user, response } = await requireAuthUser();
  if (response || !user) {
    return response || NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!fixtureStoreEnabled()) {
    return NextResponse.json(
      {
        error:
          "Offline mode is off. Set GSTUDIO_FIXTURE_TIMELINES to a scratch file (e.g. fixtures/local.json) and restart the dev server, then load again.",
      },
      { status: 409 },
    );
  }

  const target = fixtureStorePath();
  const name = basename(target);
  // The same set auto-flush refuses, from one place — two copies of this list
  // would eventually disagree about which files are generator-owned.
  if (fixtureStoreIsGenerated()) {
    return NextResponse.json(
      {
        error: `${name} is a generated fixture and will not be overwritten. Point GSTUDIO_FIXTURE_TIMELINES at a scratch file (e.g. fixtures/local.json) and restart the dev server.`,
      },
      { status: 409 },
    );
  }

  const body = await readJsonObject(request);
  const documents = body.documents;
  if (typeof documents !== "object" || documents === null || Array.isArray(documents)) {
    return NextResponse.json(
      { error: "Expected an exported project: { projectId, documents }." },
      { status: 400 },
    );
  }

  const entries = Object.entries(documents as Record<string, unknown>);
  if (entries.length === 0) {
    return NextResponse.json({ error: "That file contains no documents." }, { status: 400 });
  }

  // Validated with the SAME predicate the write path uses, so a file this
  // accepts is a file the store can serve.
  const projectIds: string[] = [];
  for (const [id, document] of entries) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: `"${id}" is not a valid document id.` }, { status: 400 });
    }
    if (!isStoredTimelineDocument(document)) {
      return NextResponse.json(
        { error: `The document "${id}" is not a valid timeline document.` },
        { status: 400 },
      );
    }
    // Keys are what every lookup goes through, so a document whose own `id`
    // disagrees with its key would be reachable under one name and report
    // another — the shape that makes a missing-document bug hard to read.
    if (document.id !== id) {
      return NextResponse.json(
        { error: `The document "${id}" carries a different id ("${document.id}").` },
        { status: 400 },
      );
    }
    if ((document as { isProject?: unknown }).isProject === true) projectIds.push(id);
  }

  // No project root means no board to open: `fixtureListProjects` would return
  // nothing and the library would be empty, which reads as a failed import
  // rather than as a file missing one flag.
  if (projectIds.length === 0) {
    return NextResponse.json(
      { error: "No document is marked isProject — nothing would be openable." },
      { status: 400 },
    );
  }

  const projectId =
    typeof body.projectId === "string" && projectIds.includes(body.projectId)
      ? body.projectId
      : projectIds[0];

  try {
    writeFileSync(target, `${JSON.stringify({ projectId, documents }, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("[GSTUDIO_TIMELINE_IMPORT_ERROR]", error);
    return NextResponse.json(
      { error: `Unable to write ${name}.` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    projectId,
    documents: entries.length,
    // The client reloads on this: the store picks the new file up via its mtime
    // check, but a board already mounted is showing the OLD project from its own
    // session cache.
    reloadRequired: true,
    file: name,
  });
}
