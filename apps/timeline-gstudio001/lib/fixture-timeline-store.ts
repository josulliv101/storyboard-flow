import "server-only";

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

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
 * truth. It answers reads from one file and holds writes in memory; nothing
 * persists past a server restart, and no revision conflict, ownership rule, or
 * batch atomicity is modelled. Use it to look at the UI, not to trust the data
 * layer — anything about PERSISTENCE has to be verified against the real store.
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

type FixtureFile = Readonly<{
  projectId?: string;
  documents: Readonly<Record<string, TimelineDocument & { isProject?: boolean }>>;
}>;

type FixtureState = {
  documents: Map<string, TimelineDocument & { isProject?: boolean }>;
  revisions: Map<string, number>;
  /** Modified time of the JSON this was built from — see `load`. */
  sourceMtimeMs: number;
};

// On `globalThis`, not a module-level `let`. The dev server re-evaluates
// modules on every edit, and a plain module variable would drop every write
// made since the last save — turning "I added three clips" into an empty board
// the moment an unrelated file was touched.
const STATE_KEY = Symbol.for("gstudio.fixtureTimelineStore");

function load(): FixtureState {
  const globalScope = globalThis as unknown as Record<symbol, FixtureState | undefined>;
  const configured = (process.env[ENV_PATH] ?? "").trim();
  const path = isAbsolute(configured) ? configured : join(process.cwd(), configured);
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
  if (existing && existing.sourceMtimeMs === mtimeMs) return existing;

  const parsed = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;

  const state: FixtureState = {
    documents: new Map(Object.entries(parsed.documents ?? {})),
    revisions: new Map(),
    sourceMtimeMs: mtimeMs,
  };
  // Revision 1, not 0: the client treats 0 as "this document does not exist
  // yet, my first write creates it", and every fixture document plainly does
  // exist. Starting at 0 makes the first save look like a create-collision.
  for (const id of state.documents.keys()) state.revisions.set(id, 1);
  globalScope[STATE_KEY] = state;
  return state;
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
}

export function fixtureDeleteDocument(id: string): void {
  const state = load();
  state.documents.delete(id);
  state.revisions.delete(id);
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
}
