import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

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
  readStoredTimelineProjectEntries,
  type TimelineEntry,
} from "./firebase-timeline-store";

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

  // PRIME FROM ONE QUERY, through the same `inflight` map everything else uses
  // — so the walk that follows resolves from memory and issues nothing.
  //
  // Recorded as already-resolved promises rather than as documents, because
  // that is the shape `read` and `read.many` already consult: nothing
  // downstream needs to know a prefetch happened, and a document the query
  // missed simply is not there, so the walk fetches it exactly as before.
  //
  // Best effort. A query failure, a missing index, or a project whose documents
  // predate `projectId` all land the same way — nothing primed, and the walk
  // does its nine round trips. That is the whole safety property: the hint can
  // fail and only latency changes.
  const prefetched = new Set<string>();
  read.prefetchProject = async (projectId) => {
    // ONCE PER PROJECT PER REQUEST. Both `serveTimelineClosure` and the closure
    // walk itself ask — the first so the ROOT comes from the query too, the
    // second so any other caller of the walk gets the same benefit — and two
    // asks must not mean two queries.
    if (prefetched.has(projectId)) return 0;
    prefetched.add(projectId);
    const entries = await readStoredTimelineProjectEntries(projectId, requesterUid).catch(
      () => new Map<string, TimelineEntry>(),
    );
    for (const [id, entry] of entries) {
      if (inflight.has(id)) continue;
      inflight.set(id, Promise.resolve(entry));
    }
    return entries.size;
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

  const healedDocument = entry.document;

  // THE HEAL IS GONE. What follows records why, because "we used to repair
  // documents against Cloudinary on every read" is exactly the kind of thing
  // that gets reintroduced by someone finding a broken thumbnail.
  //
  // It did two unrelated jobs under one name. The DURATION backfill fixed clips
  // stored before the Search API carried durations — a one-time migration, and
  // `npm run migrate:durations` reports 0 documents to rewrite against live
  // data, so it is already done. The SRC repair re-pointed clips whose asset
  // had moved, which this app cannot cause: every upload gets a
  // timestamp-suffixed public_id, so re-uploading never overwrites, and there
  // is no rename or move anywhere in the store. Only a change made directly in
  // Cloudinary can invalidate a stored url, and the owner's call is that such a
  // clip should visibly break rather than be silently re-pointed.
  //
  // It cost 1844ms of an 1887ms serve — a listing of 311 assets fetched on
  // every board open — to discover it had nothing to do.
  //
  // Its src matching also had teeth: for clips predating provenance it keyed on
  // the bare FILENAME, so two assets named `alley` in different projects
  // collapsed onto one key. Because the result was persisted then, a plain GET
  // could repoint a clip at another project's file.
  //
  // The old note on why it was served rather than persisted, kept because the
  // hazard it describes outlives it:
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
  // ONE reader for the whole walk — the property this endpoint exists for, and
  // what makes a document read for its parent's summaries free when it becomes
  // a payload of its own.
  const read = createTimelineEntryReader(requesterUid);
  // BEFORE the root read, so the root arrives in the same query as everything
  // else. After it, this would be a second sequential round trip to save nine —
  // still a win, but a needless one when the ordering is free.
  // PHASE TIMINGS, behind the read counter's own flag.
  //
  // Added because a board render reporting "application-code: 1525ms" looked
  // like a data problem for a whole evening, and was not: warm, this serve is
  // 60ms of a 339ms request — 43ms walk, 2ms derive, 1ms heal — and the 1525ms
  // belonged to a COLD render compiling the route (`next.js: 2.2s` on the same
  // line). One line of log now answers what took an evening to guess at.
  //
  // Kept rather than deleted for that reason: the numbers are small, so the
  // next person who suspects this path can rule it out in one load instead of
  // instrumenting it again.
  const probing = process.env.GSTUDIO_COUNT_READS === "1";
  const mark = (label: string, since: number) => {
    if (probing) console.log(`[SERVEPROBE] ${label} ${Date.now() - since}ms`);
    return Date.now();
  };
  let at = Date.now();

  await read.prefetchProject?.(id).catch(() => 0);
  at = mark("prefetch", at);
  const entry = await read(id);
  if (!entry) return null;
  at = mark("root read", at);


  const closure = await ((async () =>
    loadTimelineClosure(id, requesterUid, {
      rootEntry: entry,
      read,
    }).catch((error: unknown) => {
      if (error instanceof TimelineClosureTooLargeError) return null;
      throw error;
    }))());
  if (closure === null) return null;
  at = mark("closure walk", at);

  // No heal, and so no Cloudinary listing on this path at all — see
  // `serveTimelineDocument` for what it did and why it went.
  const healedDocument = entry.document;
  const missing = new Set(closure.missing);
  const summarized = deriveClosureSummaries(
    { ...closure.documents, [id]: healedDocument },
    missing,
  );

  const documents: Record<string, ServedTimeline> = {};
  at = mark("derive summaries", at);
  for (const [documentId, document] of Object.entries(summarized)) {
    if (missing.has(documentId)) continue;
    documents[documentId] = { document, revision: closure.revisions[documentId] ?? 0 };
  }
  mark("heal + assemble", at);
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
