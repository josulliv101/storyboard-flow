import "server-only";

import type { TimelineDocument } from "@storyboard/timeline-model/types";

import { readStoredTimelineEntry, type TimelineEntry } from "./firebase-timeline-store";

/**
 * How a caller reads documents.
 *
 * Declared HERE rather than in `serve-timeline`, which re-exports it: the
 * closure walk is what consumes `many`, and this module must not import from
 * its own caller.
 */
export type TimelineEntryReader = ((id: string) => Promise<TimelineEntry | null>) & {
  /** Optional bulk path — see `createTimelineEntryReader`. A plain function
   *  still satisfies this type, which is what test readers hand in. */
  many?: (ids: readonly string[]) => Promise<Map<string, TimelineEntry | null>>;
  /**
   * Optional single-query prime of a whole project, resolving the returned
   * count. See `readStoredTimelineProjectEntries` — it collapses the walk's
   * round trips without changing what the walk decides.
   */
  prefetchProject?: (projectId: string) => Promise<number>;
};

// The nested document closure for a timeline: the root plus every document
// reachable through collection clips, breadth-first with a visited set (a
// reference cycle in stored data terminates the WALK here; the manifest
// compiler still refuses to flatten it). A child that fails to load —
// missing, or another user's — is substituted with an EMPTY document and
// reported, so a dangling reference degrades that branch to silence
// instead of failing the whole preview.
//
// BOUNDED and LEVEL-PARALLEL. This used to await one read per document in a
// `while (queue.length)` loop, with no ceiling on how many documents it would
// visit — so latency was `depth × breadth` sequential round trips, and a
// deeply nested (or maliciously shaped) tree could run past the platform's
// execution limit. The preview manifest recompiles on a trailing 2.5s debounce
// after every settled edit burst, so this is a hot path during editing, not a
// once-per-session load.

/**
 * Ceiling on how many documents ONE closure may visit. Mirrors
 * `MAX_CASCADE_DOCUMENTS` in the store: past this the structure is
 * pathological, and a preview that refuses loudly beats a function that runs
 * until the platform kills it.
 */
export const MAX_CLOSURE_DOCUMENTS = 500;

/** How many documents of one BFS level are read at once. Firestore handles far
 *  more, but the point is to overlap latency, not to fan out without limit. */
const READ_CONCURRENCY = 12;

export class TimelineClosureTooLargeError extends Error {
  constructor(rootId: string) {
    super(
      `Timeline "${rootId}" reaches more than ${MAX_CLOSURE_DOCUMENTS} documents.`,
    );
    this.name = "TimelineClosureTooLargeError";
  }
}

async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  limit: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const results: Out[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function loadTimelineClosure(
  rootId: string,
  requesterUid: string,
  options?: Readonly<{
    /**
     * The root's already-read entry. The preview-manifest route reads the root
     * itself (that read IS its 404 check) and used to hand this loader nothing,
     * so the root was fetched a second time on every compile.
     */
    rootEntry?: TimelineEntry | null;
    /**
     * How to read one document. Defaults to a direct Firebase read.
     *
     * Exists so `serveTimelineDocument` can hand in the SHARED reader it
     * already uses — that reader de-duplicates reads across one request, and a
     * closure walk that bypassed it would re-fetch documents the caller had
     * just loaded. It is also the seam its tests inject through.
     */
    read?: TimelineEntryReader;
    /**
     * Stop descending after this many levels below the root. Absent = the whole
     * closure, which is what the preview/export compile needs and must keep.
     *
     * The BOARD does not need it. A board open renders the focused collection
     * plus its children as placeholder cards, so everything below the first
     * level is read only to recompute the summaries those cards display — 149
     * documents to correct four numbers per card. Bounding the walk is the
     * difference between paying for the whole project and paying for what is
     * on screen.
     */
    maxDepth?: number;
  }>,
): Promise<{
  documents: Record<string, TimelineDocument>;
  missing: string[];
  /**
   * Children the bound declined to read — NOT the same thing as `missing`.
   *
   * `missing` means the document is GONE, and the client changes what it shows
   * because of it. These exist and simply were not fetched, so a caller
   * deriving summaries must treat them as UNRESOLVED (keep the stored summary)
   * rather than absent (derive an empty collection). Merging the two lists
   * would turn a cheap read into apparent data loss.
   */
  unvisited: string[];
  /** Per-document save revisions at compile time — the manifest carries them
   *  so the client can refuse a compile that predates its own writes to ANY
   *  document in the closure, not just the root. */
  revisions: Record<string, number>;
}> {
  const documents: Record<string, TimelineDocument> = {};
  const revisions: Record<string, number> = {};
  const missing: string[] = [];
  const seen = new Set<string>([rootId]);

  const record = (id: string, entry: TimelineEntry | null): readonly string[] => {
    if (!entry) {
      // A missing ROOT is the caller's 404 to raise, not ours to hide — it is
      // recorded exactly like a missing child so the caller sees it in
      // `missing` either way.
      missing.push(id);
      documents[id] = { id, title: "", clips: [] };
      return [];
    }
    documents[id] = entry.document;
    revisions[id] = entry.revision;

    const next: string[] = [];
    for (const clip of entry.document.clips) {
      if (clip.kind !== "collection" || !clip.childTimelineId) continue;
      if (seen.has(clip.childTimelineId)) continue;
      if (seen.size >= MAX_CLOSURE_DOCUMENTS) throw new TimelineClosureTooLargeError(rootId);
      seen.add(clip.childTimelineId);
      next.push(clip.childTimelineId);
    }
    return next;
  };

  // `rootEntry: null` is a caller that looked and found nothing — honour it
  // rather than re-reading to rediscover the same absence. `undefined` means
  // the caller has no opinion.
  const read: TimelineEntryReader =
    options?.read ?? ((childId: string) => readStoredTimelineEntry(childId, requesterUid));
  const rootEntry =
    options?.rootEntry !== undefined
      ? options.rootEntry
      : await read(rootId).catch(() => null);

  // ONE QUERY BEFORE THE WALK, when the reader can do it.
  //
  // The walk below is unchanged and still authoritative: it decides what the
  // closure IS. This only puts the documents where it will look, so its nine
  // sequential levels resolve from memory instead of from nine round trips.
  // Anything the prime missed — a document written before `projectId` existed,
  // or one whose hint is stale — the walk fetches exactly as it always did.
  await read.prefetchProject?.(rootId).catch(() => 0);

  let frontier: readonly string[] = record(rootId, rootEntry);
  const unvisited = new Set<string>();
  let depth = 0;

  while (frontier.length > 0) {
    // Checked BEFORE the level is read, so `maxDepth: 1` reads the root and its
    // children and nothing deeper.
    depth += 1;
    if (options?.maxDepth !== undefined && depth > options.maxDepth) {
      for (const id of frontier) unvisited.add(id);
      break;
    }
    // ONE ROUND TRIP PER LEVEL when the reader can batch, twelve-at-a-time when
    // it cannot (hand-written readers in tests, and the un-shared default). The
    // shape of the walk is identical either way — a level is read, then
    // recorded in frontier order — so only the number of network calls moves.
    const batched = await read.many?.(frontier);
    const entries = batched
      ? frontier.map((id) => ({ id, entry: batched.get(id) ?? null }))
      : await mapWithConcurrency(frontier, READ_CONCURRENCY, async (id) => ({
          id,
          // A read that throws is a document this requester cannot see. It is
          // recorded as missing, exactly as a document that does not exist:
          // one unreadable branch must not fail the whole closure.
          entry: await read(id).catch(() => null),
        }));
    // Recorded in frontier order, so `documents` and `missing` keep the
    // deterministic ordering the sequential walk produced.
    frontier = entries.flatMap(({ id, entry }) => record(id, entry));
  }

  return { documents, missing, revisions, unvisited: [...unvisited] };
}
