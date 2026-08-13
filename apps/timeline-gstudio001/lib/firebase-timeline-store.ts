import "server-only";

import { FieldValue, Timestamp } from "firebase-admin/firestore";

import type { TimelineDocument, TimelineClip } from "@storyboard/timeline-model/types";
import { getFirebaseDb } from "./firebase-admin";
import { firstFrameUrl } from "./project-thumbnail";
import { resolveOwnership, TimelineAccessDeniedError } from "./timeline-ownership";

type TimelineDocumentRecord = {
  id: string;
  title: string;
  description?: string;
  document?: TimelineDocument;
  lastNonEmptyDocument?: TimelineDocument;
  clips?: TimelineClip[];
  isProject?: boolean;
  /** Authorization boundary. Optional only because Firestore documents are
   *  untyped at rest — every live record carries one, and a record without an
   *  owner is unreachable rather than up for grabs (see lib/timeline-ownership). */
  ownerUid?: string;
  /** Monotonic save counter, stamped on EVERY write (absent = 0, legacy).
   *  Clients that carry an expected revision into a batch write get
   *  compare-and-set semantics; clients that don't (legacy views) keep
   *  last-write-wins. */
  revision?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

/** A document plus the revision that read observed — the token a client
 *  hands back as `expectedRevision` to detect concurrent writers. */
export type TimelineEntry = {
  document: TimelineDocument;
  revision: number;
};

export type TimelineBatchWrite = {
  document: TimelineDocument;
  /** Omit for last-write-wins (legacy semantics). When present, the write
   *  only applies if the stored revision still matches. */
  expectedRevision?: number;
  /**
   * This write MEANS to leave the document with no clips.
   *
   * Per-write rather than per-batch: a removal empties the collection the item
   * came out of while the collection it went into gains one, and only the first
   * is a deliberate empty. The blanket guard stays the default for everything
   * else — an unexpected empty is still a stale client about to erase real work.
   *
   * Without this, removing the LAST item from a collection was impossible from
   * the agent tools, which matters because a per-shot lane holds exactly one
   * clip, so any correction to one hit the guard.
   */
  allowEmptying?: boolean;
};

export type TimelineRevisionConflict = {
  id: string;
  actualRevision: number;
};

/** A batch was rejected because at least one expected revision no longer
 *  matched — NOTHING in the batch was written. */
export type TimelineOrphan = Readonly<{
  /** The child that would be left with no path to it. */
  id: string;
  /** The parent that let go of it, for the message. */
  fromTimelineId: string | null;
}>;

/**
 * A write was refused because it would strand a collection document.
 *
 * Deliberately an error and not a repair. A collection reachable from nowhere
 * is invisible in the UI, absent from the trash, and recoverable only by
 * querying the database — so the owner's rule is that the app must never be
 * able to reach that state, rather than notice afterwards that it has.
 */
export class TimelineOrphanError extends Error {
  readonly orphans: readonly TimelineOrphan[];

  constructor(orphans: readonly TimelineOrphan[]) {
    super(
      `Refusing to strand ${orphans.map((orphan) => orphan.id).join(", ")}: ` +
        `removed from its parent with nothing in this write taking it up.`,
    );
    this.name = "TimelineOrphanError";
    this.orphans = orphans;
  }
}

export class TimelineRevisionConflictError extends Error {
  readonly conflicts: readonly TimelineRevisionConflict[];

  constructor(conflicts: readonly TimelineRevisionConflict[]) {
    super(
      `Timeline write conflict: ${conflicts.map((conflict) => conflict.id).join(", ")} changed since they were read.`,
    );
    this.name = "TimelineRevisionConflictError";
    this.conflicts = conflicts;
  }
}

export type TimelineProjectSummary = {
  id: string;
  title: string;
  description?: string;
  clipCount: number;
  thumbnailUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

const TIMELINE_COLLECTION = "gstudioTimelineDocuments";
const FIREBASE_TIMEOUT_MS = 8_000;

/**
 * Ceiling on ONE user's project list. This is now a per-requester product
 * limit rather than the global truncation it used to be — see
 * `listFirebaseTimelineProjects`.
 */
const PROJECT_LIST_LIMIT = 200;

async function withFirebaseTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${label} timed out. Check the Firebase project credentials and network access.`,
            ),
          );
        }, FIREBASE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function collection() {
  return getFirebaseDb().collection(TIMELINE_COLLECTION);
}

/**
 * The children this document OWNS, as opposed to merely points at.
 *
 * A collection clip whose `id` equals its `childTimelineId` is the owning
 * placement — the one whose removal makes the child unreachable. A duplicate
 * reference card is minted with its own clip id and so is excluded, which is
 * what keeps the orphan guard from refusing a legitimate edit to one.
 */
function owningCollectionChildIds(document: TimelineDocument): string[] {
  const owned: string[] = [];
  for (const clip of document.clips) {
    if (clip.kind !== "collection") continue;
    if (clip.childTimelineId !== clip.id) continue;
    owned.push(clip.childTimelineId);
  }
  return owned;
}

function normalizeDocument(document: TimelineDocument): TimelineDocument {
  return JSON.parse(JSON.stringify(document)) as TimelineDocument;
}

function normalizeClips(clips: TimelineClip[]): TimelineClip[] {
  return JSON.parse(JSON.stringify(clips)) as TimelineClip[];
}

function isTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<TimelineDocument>;

  return (
    typeof document.id === "string" &&
    typeof document.title === "string" &&
    Array.isArray(document.clips)
  );
}

function isUnsavedProjectPlaceholder(document: TimelineDocument) {
  return (
    document.id.startsWith("project-") &&
    document.title === "Loading Project" &&
    document.clips.length === 0
  );
}

function toTimelineDocument(id: string, data: Partial<TimelineDocumentRecord>) {
  const nestedDocument = isTimelineDocument(data.document)
    ? normalizeDocument(data.document)
    : null;
  const lastNonEmptyDocument = isTimelineDocument(data.lastNonEmptyDocument)
    ? normalizeDocument(data.lastNonEmptyDocument)
    : null;
  const topLevelClips = Array.isArray(data.clips)
    ? normalizeClips(data.clips)
    : null;

  if (nestedDocument) {
    if (nestedDocument.clips.length > 0) {
      return nestedDocument;
    }

    if (topLevelClips && topLevelClips.length > 0) {
      return {
        ...nestedDocument,
        clips: topLevelClips,
      };
    }

    if (lastNonEmptyDocument) {
      return {
        ...lastNonEmptyDocument,
        id: nestedDocument.id,
        title: nestedDocument.title,
        description: nestedDocument.description,
      };
    }

    return nestedDocument;
  }

  if (lastNonEmptyDocument) {
    return lastNonEmptyDocument;
  }

  return {
    id: typeof data.id === "string" ? data.id : id,
    title: data.title || id,
    description: data.description,
    clips: topLevelClips ?? [],
  } satisfies TimelineDocument;
}

function toIsoDate(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return undefined;
}

function toProjectSummary(id: string, data: Partial<TimelineDocumentRecord>): TimelineProjectSummary {
  const document = toTimelineDocument(id, data);

  return {
    id: document.id,
    title: document.title,
    description: document.description,
    clipCount: document.clips.length,
    thumbnailUrl: firstFrameUrl(document.clips),
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
  };
}

/** A missing composite index — the one failure mode of the two-filter query
 *  below that has a safe degradation rather than a bug. */
function isMissingIndexError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return code === "9" || code === "FAILED_PRECONDITION" || message.includes("requires an index");
}

/**
 * The requester's own project rows.
 *
 * BOTH filters run in the QUERY. They used to be split — `isProject` in the
 * query, ownership in JS after `.limit(100)` — which meant the limit selected
 * from every user's rows before anyone's ownership was considered. With no
 * `orderBy`, Firestore applies its implicit `__name__` ordering, and ids are
 * `project-${Date.now()}-…`, so the window was the OLDEST hundred project
 * documents in the collection. Past a hundred documents globally, a user's
 * newly created project simply fell outside it: the library rendered empty
 * while the project existed and its URL still resolved.
 *
 * Two equality filters need no composite index (Firestore merge-joins the
 * single-field ones), so this needs no deploy to work. `firestore.indexes.json`
 * declares the composite anyway — an ordered/paginated version of this query
 * will want it — and a deployment that somehow does demand one degrades to the
 * owner-only query rather than failing the page.
 */
async function ownedProjectDocs(requesterUid: string) {
  const owned = collection().where("ownerUid", "==", requesterUid);
  try {
    const snapshot = await withFirebaseTimeout(
      owned.where("isProject", "==", true).limit(PROJECT_LIST_LIMIT).get(),
      "Loading timeline projects",
    );
    return snapshot.docs;
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    // Owner-only: always served by the automatic single-field index. Reads
    // this user's child timelines too and filters `isProject` below — more
    // rows than needed, but still only ever THIS user's, which is the property
    // that matters. Loud, because it is a deployment fix, not a code path.
    console.warn(
      "[GSTUDIO_PROJECTS_INDEX_MISSING] Falling back to an owner-only project query. Deploy firestore.indexes.json.",
    );
    const snapshot = await withFirebaseTimeout(
      owned.limit(PROJECT_LIST_LIMIT).get(),
      "Loading timeline projects",
    );
    return snapshot.docs;
  }
}

export async function listFirebaseTimelineProjects(requesterUid: string) {
  const docs = await ownedProjectDocs(requesterUid);

  // Listing is READ ONLY. It used to stamp `ownerUid` onto every ownerless
  // project in the result set — one batch write per list, granting ownership to
  // whoever happened to look first. The legacy records that justified it have
  // been migrated (see lib/timeline-ownership), so unowned projects are simply
  // not visible to anyone.
  //
  // The ownership check stays even though the query now filters on it: this is
  // the module's one authorization invariant, and it should not depend on a
  // query staying shaped the way it is today. The `isProject` check is what
  // the index-missing fallback above relies on.
  const visible: { id: string; data: TimelineDocumentRecord }[] = [];
  for (const doc of docs) {
    const data = doc.data() as TimelineDocumentRecord;
    if (data.isProject !== true) continue;
    if (resolveOwnership(data.ownerUid, requesterUid) !== "owned") continue;
    visible.push({ id: doc.id, data });
  }

  return visible
    .map(({ id, data }) => toProjectSummary(id, data))
    .sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
}

/** One page of the reference scan. Small enough that a user with a handful of
 *  documents pays one round trip. */
const REFERENCE_SCAN_PAGE = 200;
/**
 * Hard ceiling on a single reference scan, in DOCUMENTS.
 *
 * Reached, the scan THROWS rather than returning what it has. An asset is
 * deleted on the strength of "nothing references this", so a scan that
 * silently stopped early is indistinguishable from a clean bill of health and
 * would take a file out from under a live clip. Incomplete must fail loudly;
 * the one failure this design accepts is leaking storage, never losing media.
 */
const REFERENCE_SCAN_MAX_DOCUMENTS = 5_000;

/** A reference scan could not be completed, so its result must not be treated
 *  as "nothing points at this". */
export class TimelineScanIncompleteError extends Error {
  constructor(scanned: number) {
    super(
      `Reference scan exceeded ${scanned} documents. Refusing to report an incomplete result.`,
    );
    this.name = "TimelineScanIncompleteError";
  }
}

/**
 * Every clip stored under a user's documents — the input to "is this uploaded
 * file still referenced".
 *
 * Deliberately a SUPERSET. It reads `document.clips`, the legacy top-level
 * `clips`, and the `lastNonEmptyDocument` recovery snapshot, because
 * `toTimelineDocument` will hand any of the three back as the live document
 * depending on what is empty — a clip only reachable through the recovery
 * snapshot is one ordinary read away from being on screen again, so it counts
 * as a reference. Over-counting leaves a file nobody uses; under-counting
 * deletes one somebody does.
 *
 * Paged to exhaustion, ordered by document id so the cursor is total. The
 * ownership filter is in the QUERY (round 12's lesson: an authorization filter
 * applied after a limit selects from everyone's rows) and re-checked here,
 * which is this module's one invariant.
 */
export async function collectOwnedTimelineClips(
  requesterUid: string,
  options: Readonly<{ excludeIds?: readonly string[] }> = {},
): Promise<TimelineClip[]> {
  const excluded = new Set(options.excludeIds ?? []);
  const clips: TimelineClip[] = [];
  // The last DOCUMENT SNAPSHOT, not its id: with `orderBy("__name__")` a
  // cursor has to resolve to a document path, and handing back the snapshot
  // the SDK just produced is the form that cannot be got wrong.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let scanned = 0;

  for (;;) {
    let query = collection()
      .where("ownerUid", "==", requesterUid)
      .orderBy("__name__")
      .limit(REFERENCE_SCAN_PAGE);
    if (cursor !== null) query = query.startAfter(cursor);

    const snapshot = await withFirebaseTimeout(query.get(), "Scanning timeline documents");
    if (snapshot.docs.length === 0) return clips;

    for (const doc of snapshot.docs) {
      scanned += 1;
      if (scanned > REFERENCE_SCAN_MAX_DOCUMENTS) {
        throw new TimelineScanIncompleteError(REFERENCE_SCAN_MAX_DOCUMENTS);
      }
      cursor = doc;
      if (excluded.has(doc.id)) continue;
      const data = doc.data() as TimelineDocumentRecord;
      if (resolveOwnership(data.ownerUid, requesterUid) !== "owned") continue;

      for (const source of [data.document?.clips, data.clips, data.lastNonEmptyDocument?.clips]) {
        if (Array.isArray(source)) clips.push(...source);
      }
    }

    if (snapshot.docs.length < REFERENCE_SCAN_PAGE) return clips;
  }
}

/**
 * ONE stored record, EXACTLY as written — collection summaries and all.
 *
 * "Stored" is the load-bearing word, and the counterpart to `serveTimelineDocument`.
 * A collection clip's `itemCount`, `previewItems` and `duration` are denormalized
 * onto the PARENT, and writes are patch-scoped: editing a child never rewrites
 * the parent that summarizes it. So those fields here are routinely, expectedly
 * WRONG — often empty for a collection whose own children are collections,
 * because nothing writes preview frames that far up the tree.
 *
 * **Raw is correct when the document is not being shown to anyone:**
 *   - a write round-trip (read, mutate, write back) — deriving here would
 *     PERSIST the summaries, which `derive-collection-summaries.ts` forbids
 *   - an existence or ownership check that never looks at the content
 *   - reading `revision` alone
 *
 * **Raw is WRONG for anything served to a reader** — a route response, an RSC
 * payload, an agent tool result. Use `serveTimelineDocument`, which recomputes
 * summaries bottom-up across the whole closure.
 *
 * That distinction used to live only in a comment, and the remote MCP
 * `read_timeline` broke it: it returned this straight to an agent, which saw
 * `previewItems: []` and a stale `itemCount` (#279). An eslint rule now keeps
 * the legitimate callers to an explicit allowlist — see `eslint.config.mjs`.
 */
export async function readStoredTimelineEntry(
  id: string,
  requesterUid: string,
): Promise<TimelineEntry | null> {
  const snapshot = await withFirebaseTimeout(
    collection().doc(id).get(),
    "Loading timeline document",
  );

  if (!snapshot.exists) return null;
  const data = snapshot.data() as TimelineDocumentRecord;
  // Reads no longer write. An ownerless record is denied like any other record
  // the requester does not own — knowing its id is not a claim to it.
  if (resolveOwnership(data.ownerUid, requesterUid) !== "owned") {
    throw new TimelineAccessDeniedError(id);
  }
  return {
    document: toTimelineDocument(snapshot.id, data),
    revision: data.revision ?? 0,
  };
}

/** `readStoredTimelineEntry` without the revision — same caveats, read them there. */
export async function readStoredTimelineDocument(id: string, requesterUid: string) {
  const entry = await readStoredTimelineEntry(id, requesterUid);
  return entry?.document ?? null;
}

export type SaveOptions = Readonly<{
  isProject?: boolean;
  /**
   * Permit a save that leaves the document with NO clips, and clear the
   * `lastNonEmptyDocument` recovery snapshot with it. Off by default: an empty
   * write is normally a stale or half-loaded client about to erase real work,
   * which the guard in `saveFirebaseTimelineEntry` rejects. The one caller
   * that means it is DELETE /api/trash — emptying the bin is the user asking
   * for exactly this document to end up empty.
   */
  allowEmptying?: boolean;
}>;

/** The one Firestore payload both write paths (single save, atomic batch)
 *  produce — shared so revision and ownership stamping can't drift
 *  between them. */
function buildSavePayload(
  normalizedDocument: TimelineDocument,
  existing: TimelineDocumentRecord | undefined,
  requesterUid: string,
  revision: number,
  options?: SaveOptions,
) {
  return {
    id: normalizedDocument.id,
    title: normalizedDocument.title,
    description: normalizedDocument.description || null,
    document: normalizedDocument,
    clips: normalizedDocument.clips,
    ...(normalizedDocument.clips.length > 0
      ? { lastNonEmptyDocument: normalizedDocument }
      : // A DELIBERATE empty (`allowEmptying` — the trash bin's Empty Trash)
        // must drop the recovery snapshot as well. `toTimelineDocument` reads
        // `lastNonEmptyDocument` back whenever the stored document has no
        // clips, so leaving it behind would re-hydrate the very clips this
        // write removed and the empty would never stick. An INCIDENTAL empty
        // (never reachable through the guard below, but merge-safe anyway)
        // leaves the snapshot exactly where it was.
        options?.allowEmptying
        ? { lastNonEmptyDocument: FieldValue.delete() }
        : {}),
    isProject: options?.isProject ?? existing?.isProject === true,
    // Ownership: a save CREATES with the requester as owner, CLAIMS a legacy
    // unowned record, and was refused earlier on someone else's. Children
    // minted implicitly through writes (collection drops) are stamped too.
    ownerUid: existing?.ownerUid ?? requesterUid,
    revision,
    createdAt: existing?.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function saveFirebaseTimelineEntry(
  document: TimelineDocument,
  requesterUid: string,
  options?: SaveOptions,
): Promise<TimelineEntry> {
  if (isUnsavedProjectPlaceholder(document)) {
    throw new Error("Refusing to save an unloaded project placeholder.");
  }

  const normalizedDocument = normalizeDocument(document);
  const ref = collection().doc(normalizedDocument.id);

  // ONE TRANSACTION for read, checks and write.
  //
  // Content here stays LAST-WRITE-WINS — legacy views carry no expectation and
  // this path deliberately doesn't invent one. What could not stay loose is the
  // REVISION. It was read outside any transaction and written back as
  // `existing + 1`, so two concurrent saves both read 5 and both wrote 6 — and
  // that number is not decoration, it is the compare-and-set token every OTHER
  // writer trusts (`saveFirebaseTimelineDocumentsAtomic`, and the agent path
  // through lib/mcp/apply-command.ts). A reader who took 6 between those two
  // writes then passed CAS against a document whose content had been replaced
  // underneath them: the exact stale-overwrite the check exists to stop,
  // permitted because two distinct writes shared one number.
  //
  // Reading inside the transaction makes `existing + 1` sound, so every write
  // gets its own number. It also closes the smaller TOCTOU the old shape had:
  // ownership and the empty-over-non-empty guard were evaluated against a read
  // that the write no longer had any claim on.
  const { revision } = await withFirebaseTimeout(
    getFirebaseDb().runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const existingData = existing.exists
        ? (existing.data() as TimelineDocumentRecord)
        : undefined;
      if (existingData && resolveOwnership(existingData.ownerUid, requesterUid) === "denied") {
        throw new TimelineAccessDeniedError(normalizedDocument.id);
      }
      const existingDocument = existingData
        ? toTimelineDocument(existing.id, existingData)
        : null;

      if (
        !options?.allowEmptying &&
        existingDocument &&
        existingDocument.clips.length > 0 &&
        normalizedDocument.clips.length === 0
      ) {
        throw new Error(
          "Refusing to save an empty timeline over an existing non-empty document.",
        );
      }

      // ORPHAN GUARD. The same rule `saveFirebaseTimelineDocumentsAtomic`
      // enforces, applied to what is simply a batch of one.
      //
      // This path had none, which made it the way around the invariant: the
      // batch endpoint refuses a write that drops a collection's last parent,
      // and PATCH on this route would take exactly that write and commit it.
      // Nothing in the app sends PATCH today — the graph view writes through
      // the batch endpoint — but "no caller right now" is not a guarantee, and
      // an open endpoint that can silently strand a document is the same hole
      // whether or not the app happens to use it.
      //
      // "Released and unclaimed" means unreachable ONLY because an owning
      // placement is unique (`clip.id === clip.childTimelineId`); a duplicate
      // reference card is minted with its own clip id and so never counts as
      // owning. That asymmetry is what makes this answerable without a reverse
      // index. With one document there is nothing else to claim what it drops,
      // so any owning child it releases is released for good.
      if (existingDocument) {
        const claimed = new Set(owningCollectionChildIds(normalizedDocument));
        const released = owningCollectionChildIds(existingDocument).filter(
          (childId) => !claimed.has(childId),
        );
        if (released.length > 0) {
          // Reads, so they must happen before the `tx.set` below. Normally
          // zero — a save that removes no collection never gets here.
          const snapshots = await Promise.all(
            released.map((childId) => tx.get(collection().doc(childId))),
          );
          // Already gone, or never there: a dangling reference being tidied
          // up, which is a repair rather than a loss.
          const stranded = released.filter((_childId, index) => snapshots[index].exists);
          if (stranded.length > 0) {
            throw new TimelineOrphanError(
              stranded.map((id) => ({ id, fromTimelineId: normalizedDocument.id })),
            );
          }
        }
      }

      const next = (existingData?.revision ?? 0) + 1;
      tx.set(
        ref,
        buildSavePayload(normalizedDocument, existingData, requesterUid, next, options),
        { merge: true },
      );
      return { revision: next };
    }),
    "Saving timeline document",
  );

  // THIS write's document and THIS write's revision, not a re-read of both.
  //
  // The old re-read could return a LATER writer's revision alongside a later
  // writer's content, and handing that pair back is worse than useless: the
  // caller would hold an expectation that passes CAS for content it never
  // produced. Reporting our own number instead fails CLOSED — if someone else
  // has since written, the caller's next compare-and-set is refused and it
  // refetches, which is the outcome the token is for.
  //
  // Nothing is lost by not re-reading: a TimelineDocument is id/title/
  // description/clips, all of which we just wrote. The server-resolved fields
  // (createdAt, updatedAt) are not part of it.
  return { document: normalizedDocument, revision };
}

export async function saveFirebaseTimelineDocument(
  document: TimelineDocument,
  requesterUid: string,
  options?: SaveOptions,
) {
  return (await saveFirebaseTimelineEntry(document, requesterUid, options)).document;
}

/**
 * ALL-OR-NOTHING multi-document save in one Firestore transaction — the
 * write path for changes that span documents (a cross-timeline move touches
 * two), where independent PATCHes could apply half a change. Per-write
 * `expectedRevision` gives compare-and-set: any mismatch aborts the WHOLE
 * batch with a TimelineRevisionConflictError listing every conflicted id
 * (so a stale client can't silently overwrite a newer writer). Ownership
 * and the empty-over-nonempty guard match the single-save path exactly.
 */
export async function saveFirebaseTimelineDocumentsAtomic(
  writes: readonly TimelineBatchWrite[],
  requesterUid: string,
): Promise<{ id: string; revision: number }[]> {
  for (const write of writes) {
    if (isUnsavedProjectPlaceholder(write.document)) {
      throw new Error("Refusing to save an unloaded project placeholder.");
    }
  }
  const ids = writes.map((write) => write.document.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A batch write must not repeat a timeline id.");
  }

  return withFirebaseTimeout(
    getFirebaseDb().runTransaction(async (tx) => {
      // Firestore transactions require every read before the first write.
      const refs = ids.map((id) => collection().doc(id));
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));

      const conflicts: TimelineRevisionConflict[] = [];
      const staged: {
        ref: (typeof refs)[number];
        id: string;
        revision: number;
        payload: ReturnType<typeof buildSavePayload>;
      }[] = [];
      // For the orphan guard below: which children this batch lets go of, and
      // which it takes up. Gathered in the loop that is already reading both
      // sides of every document, so the guard costs no extra reads here.
      const releasedChildren = new Map<string, string>();
      const claimedChildren = new Set<string>();

      for (let index = 0; index < writes.length; index += 1) {
        const normalizedDocument = normalizeDocument(writes[index].document);
        const snapshot = snapshots[index];
        const existingData = snapshot.exists
          ? (snapshot.data() as TimelineDocumentRecord)
          : undefined;

        if (existingData && resolveOwnership(existingData.ownerUid, requesterUid) === "denied") {
          throw new TimelineAccessDeniedError(normalizedDocument.id);
        }

        const actualRevision = existingData?.revision ?? 0;
        const expected = writes[index].expectedRevision;
        if (expected !== undefined && expected !== actualRevision) {
          conflicts.push({ id: normalizedDocument.id, actualRevision });
          continue;
        }

        const existingDocument = existingData
          ? toTimelineDocument(snapshot.id, existingData)
          : null;

        // OWNING placements only, on both sides.
        //
        // A collection clip whose `id` differs from its `childTimelineId` is a
        // DUPLICATE REFERENCE — a second card pointing at a timeline that lives
        // somewhere else. Dropping one of those orphans nothing, because the
        // owning placement is untouched, so counting them here would refuse a
        // legitimate edit. Multi-parent is legal in this model; that asymmetry
        // is what makes it safe to reason about from inside one batch.
        for (const childId of owningCollectionChildIds(normalizedDocument)) {
          claimedChildren.add(childId);
        }
        if (existingDocument) {
          for (const childId of owningCollectionChildIds(existingDocument)) {
            releasedChildren.set(childId, normalizedDocument.id);
          }
        }

        if (
          !writes[index].allowEmptying &&
          existingDocument &&
          existingDocument.clips.length > 0 &&
          normalizedDocument.clips.length === 0
        ) {
          throw new Error(
            "Refusing to save an empty timeline over an existing non-empty document.",
          );
        }

        staged.push({
          ref: refs[index],
          id: normalizedDocument.id,
          revision: actualRevision + 1,
          payload: buildSavePayload(
            normalizedDocument,
            existingData,
            requesterUid,
            actualRevision + 1,
            // Carries through to `lastNonEmptyDocument`, which MUST be dropped
            // for a deliberate empty: `toTimelineDocument` reads that snapshot
            // back whenever a stored document has no clips, so leaving it would
            // re-hydrate the very clips this write removed and the empty would
            // never stick.
            { allowEmptying: writes[index].allowEmptying },
          ),
        });
      }

      if (conflicts.length > 0) throw new TimelineRevisionConflictError(conflicts);

      // THE ORPHAN GUARD.
      //
      // A collection document is reachable only through a clip in some parent.
      // Drop the last such clip and the document survives in storage with no
      // path to it: invisible in the UI, absent from the trash, unrecoverable
      // without a database query. There is no reverse index to consult, so
      // this asks the one question that IS answerable from inside the batch —
      // did anything take up what this batch put down?
      //
      // A legitimate operation always answers yes, by construction. A move
      // writes source and destination together; a delete is a move into the
      // trash bin, which is itself one of the written documents. What fails is
      // half a change: the source write arriving alone, which is precisely the
      // shape the client's own error paths used to manufacture.
      const orphaned = [...releasedChildren.keys()].filter((id) => !claimedChildren.has(id));
      if (orphaned.length > 0) {
        // Reads, and they must all happen before the first `tx.set` below.
        // Bounded by the batch size, and normally zero — a batch that removes
        // nothing never gets here.
        const orphanSnapshots = await Promise.all(
          orphaned.map((id) => tx.get(collection().doc(id))),
        );
        // Already gone, or never existed: a dangling reference being tidied up,
        // which is a repair rather than a loss.
        //
        // Nothing else to check. An OWNING placement is unique — a second card
        // for the same timeline is minted with its own clip id and so is not
        // owning — which is exactly what makes "released and unclaimed" mean
        // "unreachable" without a reverse index to consult.
        const stranded = orphaned.filter((_id, index) => orphanSnapshots[index].exists);
        if (stranded.length > 0) {
          throw new TimelineOrphanError(
            stranded.map((id) => ({ id, fromTimelineId: releasedChildren.get(id) ?? null })),
          );
        }
      }

      for (const entry of staged) tx.set(entry.ref, entry.payload, { merge: true });
      return staged.map(({ id, revision }) => ({ id, revision }));
    }),
    "Saving timeline documents",
  );
}

export async function createFirebaseTimelineProject(requesterUid: string, title?: string) {
  const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cleanTitle = title?.trim().slice(0, 80) || "Untitled Project";
  const document: TimelineDocument = {
    id,
    title: cleanTitle,
    description: "Custom timeline project.",
    clips: [],
  };
  await saveFirebaseTimelineDocument(document, requesterUid, { isProject: true });
  return document;
}

/**
 * Ceiling on how many documents one cascade may touch. Real collection trees
 * are a handful of documents a few levels deep, so hitting this means the
 * structure is pathological — and a pathological tree must fail LOUDLY before
 * anything is deleted rather than half-delete and leave unreachable orphans
 * the user can no longer see or retry from.
 */
const MAX_CASCADE_DOCUMENTS = 500;

export class TimelineCascadeTooLargeError extends Error {
  constructor(id: string) {
    super(
      `Deleting timeline "${id}" would touch more than ${MAX_CASCADE_DOCUMENTS} documents.`,
    );
    this.name = "TimelineCascadeTooLargeError";
  }
}

/**
 * Delete a document and the collection sub-timelines beneath it.
 *
 * The traversal is breadth-first with a VISITED SET, which is what keeps a
 * malformed graph from taking the process down: `childTimelineId` values live
 * in stored clips and are attacker-suppliable, nothing in the write path
 * forbids a cycle, and the previous recursive walk re-entered A → B → A until
 * the stack gave out (it deleted the parent only AFTER recursing, so the cycle
 * never broke itself). A diamond — two clips pointing at one child — likewise
 * used to enqueue that child twice.
 *
 * Reads and writes are separated: the whole id set is collected first, so a
 * refusal (foreign owner at the root, oversized tree) happens before any
 * document is removed.
 *
 * NOT addressed here, deliberately: a child referenced by a DIFFERENT project
 * is still deleted along with this one. Fixing that needs inbound-reference
 * counting or explicit per-document parentage in the stored model, which is a
 * schema decision rather than a traversal fix.
 */
/** Documents of one BFS level read at once. The walk used to await one read
 *  at a time, so a 500-document tree was 500 sequential round trips before a
 *  single delete had been issued. */
const CASCADE_READ_CONCURRENCY = 12;
/** Firestore's own ceiling on a WriteBatch, and the reason
 *  MAX_CASCADE_DOCUMENTS is 500: the whole cascade fits in one atomic batch. */
const FIRESTORE_BATCH_LIMIT = 500;

export async function deleteFirebaseTimelineDocument(id: string, requesterUid: string) {
  const visited = new Set<string>([id]);
  // Root-first, so reversing it deletes the deepest documents first and the
  // root last — relevant only in the multi-batch path below, where a failure
  // part-way leaves a visibly broken parent the user can retry from rather
  // than invisible orphans under a vanished root.
  const toDelete: string[] = [];
  let frontier: string[] = [id];

  while (frontier.length > 0) {
    // Bounded concurrency rather than one Promise.all over the whole level: a
    // wide tree should overlap latency, not open an unbounded number of
    // connections at once. Order is preserved so `toDelete` stays root-first.
    const snapshots = await withFirebaseTimeout(
      mapWithConcurrency(frontier, CASCADE_READ_CONCURRENCY, async (currentId) => ({
        currentId,
        snapshot: await collection().doc(currentId).get(),
      })),
      "Loading timeline documents for deletion",
    );

    const next: string[] = [];
    for (const { currentId, snapshot } of snapshots) {
      if (!snapshot.exists) {
        // A dangling child reference is nothing to delete. The ROOT still gets
        // a (no-op) delete so callers see the same success as before.
        if (currentId === id) toDelete.push(currentId);
        continue;
      }

      const data = snapshot.data() as TimelineDocumentRecord;
      if (resolveOwnership(data.ownerUid, requesterUid) === "denied") {
        // At the root this is the authorization answer. Deeper it means a
        // stored clip pointed at someone else's document: skip it, and keep
        // deleting the requester's own tree.
        if (currentId === id) throw new TimelineAccessDeniedError(id);
        continue;
      }

      toDelete.push(currentId);

      // THE SAME CLIPS THE PRODUCT SERVES, resolved by the same function.
      //
      // This read `data.document?.clips ?? []` and was the only single-source
      // reader in the file. A record whose live clips resolve from the legacy
      // top-level `clips`, or from the `lastNonEmptyDocument` recovery
      // snapshot, has no `document.clips` — so the walk enqueued no children,
      // deleted the root alone, and left every sub-collection beneath it
      // unreachable but still owned. `collectOwnedTimelineClips` then goes on
      // counting that orphan's clips as live references, so its media is never
      // eligible for reclaim and nothing can reach the orphan to delete it: a
      // silent, permanent storage leak.
      //
      // Calling `toTimelineDocument` rather than re-implementing the
      // precedence is the point. That precedence is subtler than it looks —
      // with no `document`, a recovery snapshot wins over top-level clips
      // entirely — and a second copy of a rule like that is a second chance to
      // disagree, which is the bug being fixed.
      //
      // NOT the superset `collectOwnedTimelineClips` uses. That one
      // deliberately unions all three sources because over-counting a
      // REFERENCE only leaks a file, while under-counting deletes one in use.
      // Deleting has the opposite asymmetry: a child listed only in a stale
      // recovery snapshot may have been moved elsewhere and be perfectly
      // alive, and cascading into it would destroy live work. Delete what the
      // product would show; count references from everything.
      for (const clip of toTimelineDocument(currentId, data).clips) {
        if (clip.kind !== "collection" || !clip.childTimelineId) continue;
        // Already queued or already deleted — a cycle or a diamond.
        if (visited.has(clip.childTimelineId)) continue;
        if (visited.size >= MAX_CASCADE_DOCUMENTS) {
          throw new TimelineCascadeTooLargeError(id);
        }
        visited.add(clip.childTimelineId);
        next.push(clip.childTimelineId);
      }
    }
    frontier = next;
  }

  // ONE atomic batch for the whole cascade, where it fits — which, given
  // MAX_CASCADE_DOCUMENTS, is every case that is allowed through. Individually
  // awaited deletes meant a transient failure mid-loop left the project half
  // removed; a batch either applies completely or not at all.
  for (const group of chunk(toDelete.reverse(), FIRESTORE_BATCH_LIMIT)) {
    const batch = getFirebaseDb().batch();
    for (const documentId of group) batch.delete(collection().doc(documentId));
    await withFirebaseTimeout(batch.commit(), "Deleting timeline documents");
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

/** Run `task` over `items` with at most `limit` in flight, results in input
 *  order. */
async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  task: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results: Out[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
