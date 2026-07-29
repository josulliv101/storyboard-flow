import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { listCloudinaryAssets } from "./cloudinary-media-store";
import {
  collectionChildIds,
  deriveCollectionSummaries,
} from "./derive-collection-summaries";
import {
  getFirebaseTimelineEntry,
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
    const request = getFirebaseTimelineEntry(id, requesterUid);
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
  read: TimelineEntryReader = (childId) => getFirebaseTimelineEntry(childId, requesterUid),
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

  // Collection summaries derive from the CHILD documents at read time
  // (see deriveCollectionSummaries) — served fresh, never persisted. A
  // child that fails to load (missing, or not this user's) keeps the
  // stored summary.
  const childIds = collectionChildIds(healedDocument);
  const childDocuments = new Map(
    await Promise.all(
      childIds.map(async (childId) => {
        const child = await read(childId).catch(() => null);
        return [childId, child?.document ?? null] as const;
      }),
    ),
  );
  const derived = deriveCollectionSummaries(healedDocument, childDocuments);

  return { document: derived.document, revision };
}

/** The user's trash document — an empty default (revision 0 = the first
 *  write compare-and-set creates it) until something is stored. */
export async function serveTrashDocument(
  id: string,
  requesterUid: string,
  read: TimelineEntryReader = (trashId) => getFirebaseTimelineEntry(trashId, requesterUid),
): Promise<ServedTimeline> {
  const entry = await read(id);
  return {
    document: entry?.document ?? { id, title: "Trash Bin", clips: [] },
    revision: entry?.revision ?? 0,
  };
}
