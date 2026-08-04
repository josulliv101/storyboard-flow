import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { listCloudinaryAssets } from "./cloudinary-media-store";
import {
  collectionChildIds,
  deriveClosureSummaries,
  deriveCollectionSummaries,
} from "./derive-collection-summaries";
import {
  loadTimelineClosure,
  TimelineClosureTooLargeError,
} from "./load-timeline-closure";
import {
  readStoredTimelineEntry,
  type TimelineEntry,
} from "./firebase-timeline-store";
import { healTimelineDocument } from "./heal-timeline-document";

// The ONE serve path for a stored timeline document — used by the
// GET /api/timelines/[id] route AND the RSC payload loaders, so the two
// transports can never drift: load-time self-heal (served, never persisted —
// see below), then read-time collection-summary derivation from the child
// documents. Both are READ-ONLY repairs: this path issues no writes, so the
// revision it reports is always the one actually stored.

export type ServedTimeline = Readonly<{
  document: TimelineDocument;
  revision: number;
}>;

/**
 * A read of one stored entry, shared across everything serving ONE request.
 *
 * Serving a document reads all of its children to derive collection summaries.
 * A caller that then serves those children individually (the RSC focus-path
 * loader does exactly that) re-reads every one of them, plus their children.
 * Passing the same reader through collapses those into one read per document
 * per request.
 *
 * Rejections are memoized along with successes on purpose: a
 * `TimelineAccessDeniedError` is a stable answer for the life of a request,
 * and re-reading to rediscover it would defeat the point.
 */
export type TimelineEntryReader = (id: string) => Promise<TimelineEntry | null>;

export function createTimelineEntryReader(requesterUid: string): TimelineEntryReader {
  const inflight = new Map<string, Promise<TimelineEntry | null>>();
  return (id) => {
    const cached = inflight.get(id);
    if (cached) return cached;
    const request = readStoredTimelineEntry(id, requesterUid);
    inflight.set(id, request);
    return request;
  };
}

/** Null when the document doesn't exist; throws TimelineAccessDeniedError
 *  for someone else's (callers map it to their 404). */
export async function serveTimelineDocument(
  id: string,
  requesterUid: string,
  /** Share one across a request to avoid re-reading documents (see
   *  `createTimelineEntryReader`). Defaults to an un-shared direct read. */
  read: TimelineEntryReader = (childId) => readStoredTimelineEntry(childId, requesterUid),
): Promise<ServedTimeline | null> {
  const entry = await read(id);
  if (!entry) return null;

  const cloudinaryAssets = await listCloudinaryAssets(requesterUid).catch(() => []);
  const { document: healedDocument } = healTimelineDocument(entry.document, cloudinaryAssets);

  // The heal is SERVED, NOT PERSISTED.
  //
  // It used to write itself back through `saveFirebaseTimelineEntry`, whose
  // single-document path is explicitly last-write-wins — and it did so after
  // awaiting the asset listing, holding a document read BEFORE that round
  // trip. A batch write landing in the gap (another tab, the same tab's own
  // autosave) was overwritten by this stale copy, and because the client's
  // revision ledger still expected the version it wrote, the user's next edit
  // lost its compare-and-set and was refused with "changed in another view".
  // A GET should not be able to do that.
  //
  // Nothing is lost by only serving it: the client builds its graph from what
  // it is served, so the repaired srcs and durations ride out on the next
  // ordinary write through the batch path — which carries an expected
  // revision and therefore cannot clobber a concurrent writer. Read-only
  // sessions simply see correct content and write nothing at all. A repair
  // that must be durable belongs in a migration script, not a read.
  const revision = entry.revision;

  // Collection summaries derive at read time — served fresh, never persisted.
  //
  // ACROSS THE WHOLE CLOSURE, not one level down, and that distinction is a
  // bug fix rather than a refinement. `deriveCollectionSummaries` reads its
  // children's STORED summaries; combined with "served, never persisted",
  // that meant a nested summary was only ever fresh inside a response and
  // never in storage. So a card two or more levels above real media showed
  // whatever was last written there — for a collection whose children are all
  // collections, often nothing at all, which silently dropped it out of its
  // parent's preview frames and made the parent show the NEXT sibling's image.
  //
  // The board then corrected itself on hydration, because the live graph walk
  // descends the real tree: the card visibly swapped one image for another a
  // moment after it appeared. Deriving bottom-up removes the disagreement at
  // the source — the served summary is now computed from freshly derived
  // children at every depth, so it already matches what the live walk finds.
  const closure = await loadTimelineClosure(id, requesterUid, {
    rootEntry: entry,
    read,
  }).catch((error: unknown) => {
    // A pathological tree must not make the document unopenable. Fall back to
    // the one-level derivation: less fresh at depth, but the same answer this
    // path gave before, and the board still self-corrects on hydration.
    if (error instanceof TimelineClosureTooLargeError) return null;
    throw error;
  });

  if (closure === null) {
    const childDocuments = new Map(
      await Promise.all(
        collectionChildIds(healedDocument).map(async (childId) => {
          const child = await read(childId).catch(() => null);
          return [childId, child?.document ?? null] as const;
        }),
      ),
    );
    return { document: deriveCollectionSummaries(healedDocument, childDocuments).document, revision };
  }

  // The HEAL applies to the root only (it always has), so the healed copy has
  // to replace the walker's raw one before deriving — otherwise the repaired
  // srcs and durations would be thrown away by this substitution.
  const summarized = deriveClosureSummaries(
    { ...closure.documents, [id]: healedDocument },
    new Set(closure.missing),
  );

  return { document: summarized[id] ?? healedDocument, revision };
}

/** The user's trash document — an empty default (revision 0 = the first
 *  write compare-and-set creates it) until something is stored. */
export async function serveTrashDocument(
  id: string,
  requesterUid: string,
  read: TimelineEntryReader = (trashId) => readStoredTimelineEntry(trashId, requesterUid),
): Promise<ServedTimeline> {
  const entry = await read(id);
  return {
    document: entry?.document ?? { id, title: "Trash Bin", clips: [] },
    revision: entry?.revision ?? 0,
  };
}
