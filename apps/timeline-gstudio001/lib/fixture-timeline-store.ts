import "server-only";

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import type { TimelineEntry, TimelineProjectSummary } from "./firebase-timeline-store";

/**
 * An OFFLINE timeline store, backed by a JSON file instead of Firestore.
 *
 * Why it exists: Firestore's free tier allows 50,000 document reads a day, and
 * a day of development on a large project reaches that (see #437 — entering the
 * graph view invalidates every cached document). When it runs out, the app is
 * unopenable until midnight Pacific and no UI work can be done at all. This is
 * the way back in: a board full of dummy content that never touches the network.
 *
 * WHAT IT IS NOT. This is not a Firestore emulator and not a second source of
 * truth. No revision conflict, ownership rule, or batch atomicity is modelled:
 * offline writes always succeed. Use it to look at the UI, not to trust the data
 * layer — anything about PERSISTENCE SEMANTICS has to be verified against the
 * real store.
 *
 * WRITES DO PERSIST, as of the auto-flush below, and that is a change from what
 * this file used to promise. Writes were memory-only, which meant the board said
 * "Saved" and a restart silently discarded the work — the indicator was telling
 * the truth about the in-memory store and nothing about the file, and there was
 * no way to tell those apart from the UI. Every mutation now writes the JSON
 * back, so "Saved" means saved. What is still NOT modelled is everything in the
 * paragraph above: acceptance is not validation.
 *
 * ── Refused in production, unconditionally ─────────────────────────────────
 *
 * This bypasses the ownership check that is the store's one authorization
 * invariant, because dummy documents have no owner. A flag that both fakes the
 * database and disables access control must not be one environment variable
 * away from being live, so `NODE_ENV === "production"` refuses it outright and
 * the variable is ignored rather than honoured.
 */

const ENV_PATH = "GSTUDIO_FIXTURE_TIMELINES";

export function fixtureStoreEnabled(): boolean {
  // Both halves, in this order. The NODE_ENV check is the one that matters and
  // it is deliberately not overridable.
  if (process.env.NODE_ENV === "production") return false;
  return (process.env[ENV_PATH] ?? "").trim().length > 0;
}

/**
 * The JSON file this store reads, resolved.
 *
 * Exported because the import route WRITES this file, and a second copy of the
 * relative-path resolution is the kind of duplication that fails silently: the
 * writer would create `./fixtures/local.json` from one working directory while
 * the reader stats another, and the import would appear to succeed and change
 * nothing. One resolver, used by both.
 */
export function fixtureStorePath(): string {
  const configured = (process.env[ENV_PATH] ?? "").trim();
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

type FixtureFile = Readonly<{
  projectId?: string;
  documents: Readonly<Record<string, TimelineDocument & { isProject?: boolean }>>;
}>;

type FixtureState = {
  documents: Map<string, TimelineDocument & { isProject?: boolean }>;
  revisions: Map<string, number>;
  /** Modified time of the JSON this was built from — see `load`. */
  sourceMtimeMs: number;
  /**
   * WHICH file it was built from, and half the cache key.
   *
   * The check was mtime alone, which is only sound while the path never
   * changes. Point `GSTUDIO_FIXTURE_TIMELINES` at a different file whose mtime
   * happens to match the cached one — trivially possible, since filesystem
   * timestamp granularity means two files written in the same millisecond are
   * indistinguishable — and the store serves the PREVIOUS file's board from
   * cache. Found by the auto-flush tests, where each test points at a fresh
   * file: one test's documents appeared in another's, and then got flushed to
   * disk under the wrong name.
   */
  sourcePath: string;
  /** Carried so a flush can write it back. The field is informational (nothing
   *  reads it to resolve a board) but dropping it on every save would strip it
   *  out of a file the import route deliberately put it in. */
  projectId?: string;
};

/**
 * Fixtures a GENERATOR owns, which auto-flush and the import route must never
 * overwrite.
 *
 * `dev-timelines.json` is committed. `scale-probe.json` is gitignored but
 * reproducible from `scripts/make-scale-probe.mjs`, and is the baseline the
 * read-volume numbers are quoted against — replacing it with somebody's project
 * would leave the measurements comparing against something only one machine has.
 *
 * Shared with the import route so the two cannot disagree about what is
 * off-limits.
 */
export const GENERATED_FIXTURES: ReadonlySet<string> = new Set([
  "scale-probe.json",
  "dev-timelines.json",
]);

/** Whether the configured fixture is generator-owned, i.e. read-only to us. */
export function fixtureStoreIsGenerated(): boolean {
  return GENERATED_FIXTURES.has(basename(fixtureStorePath()));
}

// On `globalThis`, not a module-level `let`. The dev server re-evaluates
// modules on every edit, and a plain module variable would drop every write
// made since the last save — turning "I added three clips" into an empty board
// the moment an unrelated file was touched.
const STATE_KEY = Symbol.for("gstudio.fixtureTimelineStore");

function load(): FixtureState {
  const globalScope = globalThis as unknown as Record<symbol, FixtureState | undefined>;
  const path = fixtureStorePath();
  // RELOAD WHEN THE FILE CHANGES, and keep the cache otherwise.
  //
  // The cache is what lets writes survive HMR, and it is also what made
  // regenerating the JSON appear to do nothing: the state was built once per
  // server process, so a fresh fixture needed a server restart to be seen —
  // which reads exactly like the generator being broken. One stat per read is
  // cheap next to the Firestore round trip this stands in for.
  //
  // The cost is honest and worth stating: reloading DISCARDS in-memory writes,
  // because the file is the new truth. Editing the fixture resets the board.
  const mtimeMs = statSync(path).mtimeMs;
  const existing = globalScope[STATE_KEY];
  // BOTH halves: same file, unchanged since we read it. See `sourcePath`.
  if (existing && existing.sourcePath === path && existing.sourceMtimeMs === mtimeMs) {
    return existing;
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;

  const state: FixtureState = {
    documents: new Map(Object.entries(parsed.documents ?? {})),
    revisions: new Map(),
    sourceMtimeMs: mtimeMs,
    sourcePath: path,
    projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
  };
  // Revision 1, not 0: the client treats 0 as "this document does not exist
  // yet, my first write creates it", and every fixture document plainly does
  // exist. Starting at 0 makes the first save look like a create-collision.
  for (const id of state.documents.keys()) state.revisions.set(id, 1);
  globalScope[STATE_KEY] = state;
  return state;
}

/**
 * Write the in-memory board back to its JSON file.
 *
 * Called after every mutation, so "Saved" in the UI means the file. Cheap in
 * practice because the caller is already debounced: the gateway batches a burst
 * of edits into one write ~900ms after you stop, so this runs once per save, not
 * once per drag.
 *
 * ── The mtime dance ────────────────────────────────────────────────────────
 *
 * `load` rebuilds from disk whenever the file's mtime moves, which is how
 * regenerating a fixture is picked up without a restart. Our own write moves it
 * too — so without adopting the new mtime here, the very next read would decide
 * the file had changed underneath it and re-parse what we just wrote. Correct
 * but wasteful, and it would throw away the revision ledger (rebuilt at 1) on
 * every save, making the next CAS write look like a conflict. Adopting the mtime
 * is what keeps a flush invisible to the reader.
 *
 * ── Refusals and failures ──────────────────────────────────────────────────
 *
 * GENERATED FIXTURES ARE NEVER WRITTEN. Pointing offline mode at
 * `scale-probe.json` and dragging one card would otherwise rewrite the
 * read-volume baseline as a side effect of looking at the UI. Those stay
 * memory-only, exactly as everything was before this existed — so the old
 * behaviour is still available by pointing at a generated file.
 *
 * A FAILED WRITE MUST NOT FAIL THE SAVE. Disk full, file locked, permissions:
 * the in-memory write already succeeded and the board is correct: throwing here
 * would surface a scratch-file problem as a failed edit. Logged loudly instead,
 * because a silent no-op would put us straight back in the state this change
 * exists to fix — a UI saying "Saved" over a file that is not.
 */
function flush(state: FixtureState): void {
  if (fixtureStoreIsGenerated()) return;
  const path = fixtureStorePath();
  try {
    const documents: Record<string, TimelineDocument & { isProject?: boolean }> = {};
    for (const [id, document] of state.documents) documents[id] = document;
    const payload = state.projectId === undefined ? { documents } : { projectId: state.projectId, documents };
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    state.sourceMtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    console.error("[GSTUDIO_FIXTURE_FLUSH_FAILED]", path, error);
  }
}

/** A DEEP copy, so a caller mutating what it was served cannot edit the store
 *  underneath the next reader. The real store returns fresh objects from
 *  Firestore every time; this has to imitate that or it teaches wrong lessons. */
function copy<T>(value: T): T {
  return structuredClone(value);
}

export function fixtureReadEntry(id: string): TimelineEntry | null {
  const state = load();
  const document = state.documents.get(id);
  if (!document) return null;
  return { document: copy(document), revision: state.revisions.get(id) ?? 1 };
}

export function fixtureWriteDocuments(documents: readonly TimelineDocument[]): void {
  const state = load();
  for (const document of documents) {
    const previous = state.documents.get(document.id);
    state.documents.set(document.id, {
      ...copy(document),
      // `isProject` is set once at creation and never travels on a clips write,
      // so carrying it forward is what stops a save demoting the project into
      // an ordinary timeline and dropping it out of the project list.
      ...(previous?.isProject ? { isProject: true } : {}),
    });
    state.revisions.set(document.id, (state.revisions.get(document.id) ?? 0) + 1);
  }
  // ONE flush for the whole batch, not one per document: the gateway sends a
  // move's source and target together precisely so they cannot half-land, and
  // writing the file mid-loop would put a half-applied board on disk.
  flush(state);
}

export function fixtureDeleteDocument(id: string): void {
  const state = load();
  state.documents.delete(id);
  state.revisions.delete(id);
  flush(state);
}

export function fixtureListProjects(): TimelineProjectSummary[] {
  const state = load();
  const out: TimelineProjectSummary[] = [];
  for (const [id, document] of state.documents) {
    if (document.isProject !== true) continue;
    // No timestamps: the fixture has no clock (the generator is deterministic
    // by design) and the field is optional. A fabricated date would sort the
    // list by a number that means nothing.
    out.push({
      id,
      title: document.title,
      description: document.description,
      clipCount: document.clips.length,
    });
  }
  return out;
}

/** Whether the store already holds this id — the create path's existence check. */
export function fixtureHasDocument(id: string): boolean {
  return load().documents.has(id);
}

export function fixtureCreateProject(id: string, title: string): void {
  const state = load();
  state.documents.set(id, { id, title, clips: [], isProject: true });
  state.revisions.set(id, 1);
  flush(state);
}
