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
  type TimelineEntryReader,
  TimelineClosureTooLargeError,
} from "./load-timeline-closure";
import {
  readStoredTimelineEntries,
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
export type { TimelineEntryReader } from "./load-timeline-closure";

export function createTimelineEntryReader(requesterUid: string): TimelineEntryReader {
  const inflight = new Map<string, Promise<TimelineEntry | null>>();
  const read: TimelineEntryReader = (id) => {
    const cached = inflight.get(id);
    if (cached) return cached;
    const request = readStoredTimelineEntry(id, requesterUid);
    inflight.set(id, request);
    return request;
  };

  // The BATCH GOES THROUGH THE SAME `inflight` MAP, which is the whole point:
  // batch-get shares one reader across several roots, so an id already being
  // read for one root must not be re-read for the next. Ids already in flight
  // are awaited, only the rest are fetched, and the results are recorded so a
  // later single read joins this batch instead of issuing its own get().
  read.many = async (ids) => {
    const out = new Map<string, TimelineEntry | null>();
    const wanted: string[] = [];
    const joined: Promise<void>[] = [];
    for (const id of new Set(ids)) {
      const cached = inflight.get(id);
      if (cached) {
        // A rejected read is a document this caller cannot see; the walk turns
        // that into "missing" rather than failing the level (see below).
        joined.push(cached.then((entry) => void out.set(id, entry), () => void out.set(id, null)));
      } else {
        wanted.push(id);
      }
    }

    const batch = wanted.length
      ? readStoredTimelineEntries(wanted, requesterUid)
      : Promise.resolve(new Map<string, TimelineEntry | null>());
    // Seeded BEFORE the await so a concurrent reader joins rather than races.
    // Falling back to null on a failed batch keeps a doomed request from
    // leaving unhandled rejections behind it — the failure itself still
    // propagates through the await below.
    for (const id of wanted) {
      inflight.set(id, batch.then((entries) => entries.get(id) ?? null, () => null));
    }

    const entries = await batch;
    for (const id of wanted) out.set(id, entries.get(id) ?? null);
    await Promise.all(joined);
    return out;
  };

  return read;
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

/**
 * Serve a timeline AND every document reachable from it, in one answer.
 *
 * ── Why this is nearly free ────────────────────────────────────────────────
 *
 * `serveTimelineDocument` above ALREADY walks the whole closure and already
 * derives a summarized document for every id in it — that is what
 * `deriveClosureSummaries` returns — and then returns exactly one of them and
 * discards the rest. The client, having been given only the root, asks for each
 * child in turn, and each of those requests walks its own subtree again.
 *
 * So this does not add work. It stops throwing work away.
 *
 * Measured on a 151-document project: serving it per document cost 58 requests
 * and ~430 reads, batching those requests brought it to 19 and 237, and this
 * makes it one request and one read per document (#437).
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * No heal beyond the root, matching `serveTimelineDocument` — the heal has
 * always been root-only, and widening it here would be a different change
 * hiding inside a performance one.
 *
 * MISSING documents are omitted rather than served as empty placeholders. The
 * closure walk substitutes `{ id, title: "", clips: [] }` for a child it cannot
 * read so that one dangling reference degrades to silence instead of failing
 * the whole preview — correct there, wrong here: priming that into the client's
 * cache would install a convincing empty document over an id that might simply
 * be someone else's, and the client would then never try to read it properly.
 * They come back in `missing` instead, as information.
 *
 * A TOO-LARGE closure returns null rather than throwing, so the caller can fall
 * back to serving just the root and let the client hydrate the old way. A
 * pathological tree must not make a project unopenable.
 */
export async function serveTimelineClosure(
  id: string,
  requesterUid: string,
): Promise<Readonly<{
  documents: Record<string, ServedTimeline>;
  missing: string[];
}> | null> {
  // ONE reader for the whole walk — the property this endpoint exists for.
  const read = createTimelineEntryReader(requesterUid);
  const entry = await read(id);
  if (!entry) return null;

  const cloudinaryAssets = await listCloudinaryAssets(requesterUid).catch(() => []);
  const { document: healedDocument } = healTimelineDocument(entry.document, cloudinaryAssets);

  const closure = await loadTimelineClosure(id, requesterUid, {
    rootEntry: entry,
    read,
  }).catch((error: unknown) => {
    if (error instanceof TimelineClosureTooLargeError) return null;
    throw error;
  });
  if (closure === null) return null;

  const missing = new Set(closure.missing);
  const summarized = deriveClosureSummaries(
    { ...closure.documents, [id]: healedDocument },
    missing,
  );

  const documents: Record<string, ServedTimeline> = {};
  for (const [documentId, document] of Object.entries(summarized)) {
    if (missing.has(documentId)) continue;
    documents[documentId] = { document, revision: closure.revisions[documentId] ?? 0 };
  }
  return { documents, missing: [...missing] };
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
