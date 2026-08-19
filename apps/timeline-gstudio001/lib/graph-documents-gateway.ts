import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import {
  renderFormatOf,
  sameRenderFormat,
  type RenderFormat,
} from "@storyboard/timeline-model/render-format";
import type { DocumentsById } from "@storyboard/timeline-domain";

// The graph view's ONLY coupling to persistence: GET /api/timelines/[id]
// for reads (the same contract the legacy SmoothScrollList views speak) and
// POST /api/timelines/batch for writes, fronted by an in-memory session
// cache. The graph provider replaces the legacy TimelineDocumentsProvider's
// consistency role wholesale, so this gateway deliberately does NOT touch
// that store — one storage contract, two independent view systems, which is
// what lets the graph view ship without modifying storyboard/workbench.
//
// Reads are synchronous against the cache (the timeline-domain adapter takes
// a DocumentsById snapshot); `ensure` is the async fill (hydrate-on-focus
// IO); `writeClips` is the write path — cache immediately, then ONE debounce
// window for ALL dirty documents, flushed as a single ATOMIC batch:
//
//   - Atomicity: a change that spans documents (a cross-timeline move
//     touches two) is written in the same window, so it commits or fails as
//     a unit — independent per-document PATCHes could persist half a change.
//   - Revisions: every GET carries the document's revision, every batch
//     write carries it back as `expectedRevision`. A mismatch (another tab,
//     the storyboard view) rejects the whole batch with 409 — this session's
//     stale full-document write can no longer silently overwrite a newer
//     one. Conflicted documents are reloaded; the local edit stays in the
//     GRAPH (the session's source of truth), so the user's next change
//     re-persists their intent against the fresh revision.

const SAVE_DEBOUNCE_MS = 900;
// Retry cadence for writes that failed for non-conflict reasons — slower
// than the edit debounce so a struggling server isn't hammered.
const SAVE_RETRY_MS = 5000;
// How long an ensure waits for a declared-incoming RSC prime before
// fetching itself — roughly a streamed payload's round trip.
const PRIME_WAIT_MS = 1000;
// How many trailing save batches a refresh will wait out before fetching
// anyway (see whenSavesSettled). Each round is a full round-trip, so this is
// generous for any real burst of edits while still bounding the wait.
const MAX_SAVE_DRAIN_ROUNDS = 10;
// The fetch spec caps keepalive at 64 KiB across every in-flight keepalive
// request on the page, and going over is a hard network error rather than a
// truncation. Budget under it: headers count toward the quota, and other
// code on the page (analytics beacons) may hold some of it.
const KEEPALIVE_BUDGET_BYTES = 56 * 1024;

/** Byte length of a UTF-8 body — `String.length` undercounts non-ASCII
 *  (clip titles, alt text), which is exactly how a body sneaks over quota. */
const byteLength = (value: string): number =>
  typeof TextEncoder === "function" ? new TextEncoder().encode(value).length : value.length;

/** A server-read document + revision, delivered by RSC (layout bootstrap /
 *  focus-path streams) and fed to `prime`. Defined HERE (client-safe) so
 *  the server-only loader module and the client share one shape. `forUid`
 *  stamps WHO the server read it for: `prime` refuses payloads for anyone
 *  but the bound user, so a stale RSC prop (router cache across an auth
 *  transition) can never seed another user's session. */
export type GraphServerPayload = Readonly<{
  document: TimelineDocument;
  revision: number;
  forUid: string;
}>;

/** The empty snapshot the server rendered with — one frozen object, so
 *  `useSyncExternalStore` sees a stable value. */
const EMPTY_DOCUMENTS: DocumentsById = Object.freeze({});

export type GraphDocumentsGateway = Readonly<{
  /** Snapshot of every document the session has loaded or written. */
  read: () => DocumentsById;
  /**
   * What the SERVER rendered: nothing.
   *
   * The third argument to `useSyncExternalStore` has to describe the HTML the
   * server produced, and every caller was passing `read` — the live store. That
   * store is EMPTY during SSR and PRIMED by the time hydration runs (the RSC
   * payloads install themselves during render), so React compared a server tree
   * built from no documents against a client tree built from all of them.
   *
   * In the sidebar that difference is structural — the shortcuts section exists
   * in one tree and not the other — and Next reported a hydration mismatch.
   *
   * Always the same object, because `useSyncExternalStore` re-renders forever if
   * the snapshot is a fresh value each call.
   */
  readServerSnapshot: () => DocumentsById;
  /** The document if already cached, without triggering IO. */
  peek: (timelineId: string) => TimelineDocument | null;
  /**
   * Cached document, or fetch-and-cache it. Concurrent calls for the same
   * id share one request. Resolves null when the API has no such timeline
   * (or the request failed — surfaced via `lastError`).
   */
  ensure: (timelineId: string) => Promise<TimelineDocument | null>;
  /**
   * Fill the cache with a timeline AND everything under it, in ONE request.
   *
   * The opening move on entering a board. Without it the cache fills a document
   * at a time as cards mount, and each of those reads walks its own subtree
   * server-side — 58 requests and ~430 document reads for a 151-document
   * project, against 151 for the closure the server already loaded anyway
   * (#437).
   *
   * BEST EFFORT, and the caller is expected to ignore the result. Everything it
   * primes is something `ensure` would otherwise have fetched, so a failure —
   * a closure too large to walk, a network error — costs nothing but the old
   * behaviour. It resolves once the primes are installed so a caller CAN await
   * it before hydrating, which is the difference between one request and a
   * hundred.
   */
  ensureClosure: (rootId: string) => Promise<void>;
  /**
   * The write path: update the cached document's clips now, join the
   * current debounce window — the whole dirty set goes out as one atomic
   * batch. No-op for timelines the session hasn't loaded.
   */
  writeClips: (timelineId: string, clips: TimelineClip[]) => void;
  /**
   * Persist a new TITLE for a timeline document — a collection's display
   * name. The server derives every parent's collection-clip title from the
   * child document's title, so the child document IS the source of truth;
   * writing only the parent clip would be overwritten on the next read.
   * Ensures the document is loaded first, then joins the debounce window.
   */
  renameTimeline: (timelineId: string, title: string) => Promise<void>;
  /**
   * Set the shape this project renders at, or clear it back to the default.
   *
   * A DOCUMENT-level write, exactly like `renameTimeline`: it spreads the
   * cached document and replaces one field, so the clips — and every other
   * document field — ride through untouched. That spread is what makes adding
   * a document field safe here at all; a write that rebuilt the document from
   * its clips would drop this on the next save.
   */
  setRenderFormat: (timelineId: string, format: RenderFormat | null) => Promise<void>;
  /**
   * Insert a BRAND-NEW document into the cache (a collection minted
   * client-side, e.g. a sidebar-tool drop) with an expected revision of 0 —
   * the first write is a compare-and-set CREATE, so it can never clobber a
   * document that turns out to exist. No-op when the id is already cached.
   */
  seed: (document: TimelineDocument) => void;
  /**
   * Best-effort cache refresh from a SERVER-read payload (RSC bootstrap /
   * focus-path streams): installs the document and its revision so `ensure`
   * needs no fetch and the next write carries the right expectation.
   * Guarded — never applied over local edits (dirty, or any batch in
   * flight) and never regressing the revision ledger; a skipped prime just
   * leaves the existing fetch paths to do their job.
   */
  prime: (document: TimelineDocument, revision: number, forUid: string) => void;
  /**
   * Declare that primes for these ids are INCOMING (the server is streaming
   * this navigation's payloads): an `ensure` for a missing/stale id waits a
   * short grace window for the prime before falling back to its own fetch —
   * this is what lets the RSC payload win the race against the client's
   * immediate hydration instead of duplicating the read. Only registered
   * for ids the cache can't already serve; call it only when the session is
   * KNOWN to be server-primed, or every miss pays the window for nothing.
   */
  expectPrimes: (ids: readonly string[], windowMs?: number) => void;
  /**
   * Bind this cache to an authenticated user. The FIRST bind (or a re-bind
   * to the same uid) is free; binding a DIFFERENT uid resets everything —
   * documents, revisions, dirty state, errors, in-flight work — because the
   * module singleton outlives soft logout/login, and the next user must
   * never read the previous user's documents from memory. Call before any
   * prime/ensure in an authenticated session.
   */
  bindUser: (uid: string) => void;
  /**
   * The board this session is editing, sent with every write so the server can
   * stamp `projectId` (#458).
   *
   * Separate from `bindUser` because it changes far more often — every drill
   * into a different project — and because it carries no authorization weight:
   * it is a prefetch hint, and the server validates it against the caller's own
   * scope regardless.
   */
  bindProject: (projectId: string) => void;
  /** The compare-and-set ledger's revision for a document, if known. */
  revisionOf: (timelineId: string) => number | undefined;
  /**
   * True while a write for this document is UNSETTLED — still in the debounce
   * window or in a batch whose response hasn't landed. During that window the
   * ledger cannot yet name the revision the write will produce, so a manifest
   * compiled server-side in the gap passes a pure `revisionOf` comparison even
   * when it read pre-write content. Install guards check this alongside the
   * ledger and simply wait the write out.
   */
  hasPendingWrite: (timelineId: string) => boolean;
  /**
   * True when this document lost a revision conflict and the live graph has
   * not been reconciled with the reloaded content. `writeClips` refuses these
   * ids outright; callers can read this to avoid reporting a write they did
   * not get, or to surface the state in their own UI.
   */
  isConflicted: (timelineId: string) => boolean;
  /**
   * True when a closure walk reported this id as UNRESOLVABLE — the document
   * does not exist, as opposed to not being loaded yet. Only the server can
   * tell those apart, so this is its answer, remembered.
   */
  isKnownMissing: (timelineId: string) => boolean;
  /** Record ids a SERVER walk reported unresolvable. The RSC boot path ships
   *  them alongside its payloads; `ensureClosure` records its own. */
  recordMissing: (ids: readonly string[]) => void;
  /**
   * Declare that the CACHE is ahead of the live graph for this document, so
   * clip writes projected from that graph must stop.
   *
   * `writeClips` already refuses this exact hazard for a document that lost a
   * revision conflict, and says why: the cache is fresh while the graph the
   * clips came from is not, so writing them overwrites the other writer's
   * content with a stale full collection. A 409 was only ever ONE way to reach
   * that state. The remote-change poller reaches it too — it refreshes a
   * document (and its revision) and then declines to apply the difference, at
   * which point the ledger is current, CAS will happily pass, and the next
   * ancestor write silently deletes whatever the other writer added.
   *
   * That is not hypothetical: it is how an open tab reverted two collections an
   * agent had just created, ~40s after each write, with CAS passing both times.
   * Mandatory CAS would not have caught it — the revision was correct; the
   * CONTENT was not.
   *
   * Same block and same lifting point as a conflict: cleared by `refresh()`,
   * when entering the view rebuilds the graph from fresh documents.
   */
  markGraphBehind: (timelineId: string, reason: string) => void;
  /** Cache-change notifications (documents landing, clips written). */
  subscribe: (listener: () => void) => () => void;
  /**
   * Where the write path currently stands, for a save indicator. The app
   * autosaves on a debounce, so without this the user has no way to know
   * whether an edit is committed — and undo history does not survive a
   * reload, which makes "did that save?" a question with consequences.
   *
   * `pending` counts documents waiting out the debounce window, `inFlight`
   * those in the batch being sent. Both zero with a `lastSavedAt` means
   * everything is on the server.
   */
  saveState: () => Readonly<{
    pending: number;
    inFlight: number;
    lastSavedAt: number | null;
    error: string | null;
  }>;
  /** Outstanding load/save failures, for a status banner. Null when every
   *  document is healthy; multiple failures are all listed. */
  lastError: () => string | null;
  /**
   * Surface (or clear, with null) an app-reported problem in the same
   * banner, under the caller's own key — e.g. hydration failures keyed
   * `hydrate:<id>`, so they never collide with this gateway's own load/save
   * errors for the same document. Exists because a swallowed failure once
   * cost a debugging session: anything that leaves a document unusable must
   * say so.
   */
  reportIssue: (key: string, message: string | null) => void;
  /**
   * Send the pending batch NOW. Called on pagehide/hidden (with keepalive,
   * so the request survives the tab closing) and before a refresh — closing
   * the tab inside the debounce window must not lose the last edit.
   *
   * A keepalive flush never QUEUES behind a running save: the running request
   * was created without keepalive, so teardown would kill it and the queued
   * batch would never start. It abandons that request instead and re-sends its
   * documents, plus anything dirtied since, as one unload-safe batch.
   */
  flushPendingWrites: (options?: { keepalive?: boolean }) => void;
  /**
   * Entering the graph view calls this: every cached document is marked
   * STALE, so `ensure` refetches it (after any in-flight batch settles)
   * instead of trusting the session cache. Without it, edits made in the
   * storyboard view (or another tab) between graph sessions would be
   * overwritten by full-document writes built from stale content. Cached
   * content stays readable until the refetch lands.
   */
  refresh: () => void;
  /**
   * Mark ONE document stale so the next `ensure` refetches it.
   *
   * The narrow twin of `refresh`, for the live-update poller: when the
   * revisions endpoint says a single document moved, invalidating the whole
   * session cache would refetch every other document for nothing. Unlike
   * `refresh` this does NOT flush pending writes or lift the conflict gate —
   * it only says "this one is out of date". No-op for a document the session
   * has never loaded, since there is nothing cached to distrust.
   */
  markStale: (timelineId: string) => void;
}>;

/**
 * How a pending READ BATCH is scheduled. Injectable for ONE reason: the window
 * has to be a real delay to coalesce anything (see `fetchDocument`), and a real
 * delay deadlocks a test that awaits `ensure` under fake timers. Tests pass
 * `queueMicrotask`; nothing else should.
 */
export type BatchScheduler = (flush: () => void) => void;

const DEFAULT_BATCH_SCHEDULER: BatchScheduler = (flush) => {
  setTimeout(flush, 12);
};

export function createGraphDocumentsGateway(
  options: { scheduleBatch?: BatchScheduler } = {},
): GraphDocumentsGateway {
  const scheduleBatch = options.scheduleBatch ?? DEFAULT_BATCH_SCHEDULER;
  let documents: DocumentsById = {};
  // The expected-revision ledger: revision observed at GET (or returned by
  // the last batch), per document. Absent = no expectation (a server that
  // didn't send one) — that document falls back to last-write-wins.
  const revisions = new Map<string, number>();
  // Errors are PER DOCUMENT: a successful write of one timeline must never
  // clear (and thereby hide) another timeline's failed save — with a single
  // last-error string, whichever request resolved last won.
  const errors = new Map<string, string>();
  let errorBanner: string | null = null;
  const inflight = new Map<string, Promise<TimelineDocument | null>>();
  // ONE debounce window for ALL dirty documents (not a timer per doc): a
  // change that touches several documents writes them in the same window,
  // so they travel in the SAME atomic batch.
  const dirtyIds = new Set<string>();
  /** Ids the SERVER reported as unresolvable while walking a closure — a
   *  dangling childTimelineId, not a document waiting to load. See the note in
   *  `ensureClosure`. */
  const knownMissingIds = new Set<string>();
  /** The board whose writes this session is sending — see `bindProject`. */
  let boundProjectId: string | null = null;
  // Documents this session has actually EMPTIED — observed at the moment the
  // clips went from some to none, not inferred later from a projection that
  // happens to be empty. The store refuses an empty-over-non-empty write
  // unless told the empty is deliberate, and this is what earns that
  // exemption. Held until the write COMMITS: a retry after an abandoned
  // request carries the same intent, and forgetting it there would fail the
  // resend on the very guard the first attempt was exempt from.
  const emptiedIds = new Set<string>();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // At most one batch in flight; a write requested meanwhile queues one
  // trailing batch that re-reads the latest cache. Without this, an older
  // in-flight batch could reach the server after a newer one and win.
  let saveInFlight: Promise<void> | null = null;
  let saveQueued = false;
  // Whether the in-flight batch was itself sent with keepalive — i.e. already
  // survives page teardown, so an unload flush has no reason to displace it.
  let saveInFlightKeepalive = false;
  // What the in-flight batch is carrying, so an unload flush that abandons it
  // can re-dirty those documents and re-send them itself.
  let saveInFlightIds: readonly string[] = [];
  // Abandons the in-flight batch: aborts the request AND makes its handlers
  // no-ops, so a late settle can't clobber the batch that replaced it.
  let abandonSaveInFlight: (() => void) | null = null;
  // Ids whose cached content predates the current graph session (see
  // `refresh`) or lost a revision conflict: readable, but `ensure`
  // refetches them.
  let staleIds = new Set<string>();
  // Ids that LOST a revision conflict and whose live graph has not been
  // reconciled with the reloaded document. Reloading fixes this cache; it
  // does NOT fix the graph, which still holds the pre-conflict local edit.
  // Any further clip write for such an id would be a whole-collection
  // projection of that stale graph — landing against the fresh revision and
  // silently deleting whatever the other writer added. Blocked until the
  // graph is rebuilt from documents (`refresh`, a remount, or a rebind).
  let conflictedIds = new Set<string>();
  const listeners = new Set<() => void>();

  // The AUTH BOUNDARY: which user's documents this cache holds. The module
  // singleton outlives soft logout/login, so binding a DIFFERENT uid must
  // reset everything — otherwise the next user reads the previous user's
  // documents straight from memory, bypassing every server-side ownership
  // check. `generation` invalidates async work that started before a
  // reset: a late fetch or batch response from the previous user's session
  // must not repopulate the new one.
  let boundUid: string | null = null;
  let generation = 0;
  // Primes (RSC payloads) that arrived BEFORE the user was bound. The
  // focus-path primer renders before GraphTimelineView (a `dynamic`, ssr:false
  // import) mounts and calls `bindUser`, so its payloads reach `prime` while
  // `boundUid` is still null — dropping them there left every child doc
  // un-warmed. Held here and replayed on bind (foreign uids discarded then).
  let pendingPrimes: { document: TimelineDocument; revision: number; forUid: string }[] = [];

  // When the last batch settled OK — the "Saved" half of the indicator.
  let lastSavedAt: number | null = null;
  // CACHED, and re-allocated only when a field actually changes.
  // `useSyncExternalStore` compares snapshots by identity: a getter that
  // builds a fresh object per call re-renders forever and React tears the
  // tree down. (It did — the board stopped rendering entirely.)
  let saveStateSnapshot: {
    pending: number;
    inFlight: number;
    lastSavedAt: number | null;
    error: string | null;
  } = { pending: 0, inFlight: 0, lastSavedAt: null, error: null };
  const readSaveState = () => {
    const pending = dirtyIds.size;
    const inFlight = saveInFlightIds.length;
    if (
      saveStateSnapshot.pending !== pending ||
      saveStateSnapshot.inFlight !== inFlight ||
      saveStateSnapshot.lastSavedAt !== lastSavedAt ||
      saveStateSnapshot.error !== errorBanner
    ) {
      saveStateSnapshot = { pending, inFlight, lastSavedAt, error: errorBanner };
    }
    return saveStateSnapshot;
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const reset = () => {
    generation += 1;
    documents = {};
    revisions.clear();
    errors.clear();
    errorBanner = null;
    inflight.clear();
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // Abandon BEFORE clearing the dirty set: abandoning re-dirties whatever
    // the in-flight batch was carrying, and on a reset (a different user is
    // binding) none of the previous session's documents may survive to be
    // written into the new one.
    abandonSaveInFlight?.();
    abandonSaveInFlight = null;
    dirtyIds.clear();
    emptiedIds.clear();
    saveInFlight = null;
    saveQueued = false;
    saveInFlightKeepalive = false;
    saveInFlightIds = [];
    staleIds = new Set();
    conflictedIds = new Set();
    expectedPrimes.clear();
    pendingPrimes = [];
    notify();
  };

  const setError = (timelineId: string, next: string | null) => {
    if (next === null) {
      if (!errors.delete(timelineId)) return;
    } else {
      if (errors.get(timelineId) === next) return;
      errors.set(timelineId, next);
    }
    errorBanner = errors.size === 0 ? null : [...errors.values()].join(" · ");
    notify();
  };

  /** Mirrors `MAX_BATCH_IDS` on the endpoint. Larger bursts split into chunks
   *  rather than being refused. */
  const MAX_FETCH_BATCH = 200;

  type QueuedFetch = {
    timelineId: string;
    resolve: (document: TimelineDocument | null) => void;
  };
  let fetchQueue: QueuedFetch[] = [];
  let fetchScheduled = false;
  /** Read batches currently on the wire. While any is, new ids WAIT. */
  let fetchInFlight = 0;

  type BatchReadEntry = {
    id?: string;
    document?: TimelineDocument;
    revision?: number;
    error?: string;
    /** The status the equivalent single GET would have returned. 404 is the
     *  server saying this document does not exist — the one failure worth
     *  remembering, because asking again cannot change the answer. */
    status?: number;
  };

  /** Install ONE document from a batch response into the cache. Returns the
   *  document so the waiter can resolve with it, and reports its own error. */
  const installFetched = (
    timelineId: string,
    entry: BatchReadEntry | undefined,
    next: Record<string, TimelineDocument>,
  ): TimelineDocument | null => {
    if (!entry || entry.error !== undefined || !entry.document) {
      // NOT FOUND is remembered; nothing else is. A 404 is an answer — asking
      // again cannot change it, and `ensure` skips the id from here on. A
      // transport failure, a 500 or a timeout is the OPPOSITE: the document may
      // well exist, and recording it missing would hide it for the session and
      // let the manifest compile a branch as empty rather than refuse.
      if (entry?.status === 404) knownMissingIds.add(timelineId);
      setError(
        timelineId,
        entry?.error || `Timeline "${timelineId}" failed to load.`,
      );
      return null;
    }
    if (entry.document.id !== timelineId) {
      setError(timelineId, `Timeline "${timelineId}" returned an unexpected document.`);
      return null;
    }
    next[timelineId] = entry.document;
    if (typeof entry.revision === "number") {
      revisions.set(timelineId, entry.revision);
    } else {
      // No revision from the server: drop any stale expectation rather than let
      // it force spurious conflicts.
      revisions.delete(timelineId);
    }
    setError(timelineId, null);
    return entry.document;
  };

  const runFetchBatch = async (batch: readonly QueuedFetch[]) => {
    const gen = generation;
    const ids = batch.map((item) => item.timelineId);
    try {
      const response = await fetch("/api/timelines/batch-get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
        cache: "no-store",
      });
      // A reset (auth rebind) happened while this was in flight: the response
      // belongs to the previous session and must not land.
      if (gen !== generation) {
        for (const item of batch) item.resolve(null);
        return;
      }
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (gen !== generation) {
          for (const item of batch) item.resolve(null);
          return;
        }
        // A whole-request failure is the ONLY case every id shares a message —
        // per-document failures come back inside a 200 with their own error.
        const message = result.error || `Timelines failed to load (${response.status}).`;
        for (const item of batch) {
          setError(item.timelineId, message);
          item.resolve(null);
        }
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        results?: BatchReadEntry[];
      };
      if (gen !== generation) {
        for (const item of batch) item.resolve(null);
        return;
      }
      const byId = new Map<string, BatchReadEntry>();
      for (const entry of payload.results ?? []) {
        if (typeof entry.id === "string") byId.set(entry.id, entry);
      }
      // ONE new documents object and ONE notify for the whole batch, rather
      // than a spread and a re-render per document. At fifty documents that is
      // the difference between fifty renders of the board and one.
      const next: Record<string, TimelineDocument> = { ...documents };
      const resolved = batch.map((item) => ({
        item,
        document: installFetched(item.timelineId, byId.get(item.timelineId), next),
      }));
      documents = next;
      notify();
      for (const { item, document } of resolved) item.resolve(document);
    } catch (cause) {
      if (gen !== generation) {
        for (const item of batch) item.resolve(null);
        return;
      }
      const message =
        cause instanceof Error ? cause.message : "The timeline documents failed to load.";
      for (const item of batch) {
        setError(item.timelineId, message);
        item.resolve(null);
      }
    }
  };

  const drainFetchQueue = () => {
    const queued = fetchQueue;
    fetchQueue = [];
    if (queued.length === 0) return;
    for (let at = 0; at < queued.length; at += MAX_FETCH_BATCH) {
      fetchInFlight += 1;
      void runFetchBatch(queued.slice(at, at + MAX_FETCH_BATCH)).finally(() => {
        fetchInFlight -= 1;
        // The ids that arrived DURING this request are the next batch. This is
        // the whole coalescing mechanism — see `fetchDocument`.
        if (fetchInFlight === 0) drainFetchQueue();
      });
    }
  };

  const flushFetchQueue = () => {
    fetchScheduled = false;
    // A request is already out: leave the queue alone. Its completion drains
    // whatever accumulated, as one batch.
    if (fetchInFlight > 0) return;
    drainFetchQueue();
  };


  /**
   * Fetch one document — by joining the next BATCH.
   *
   * The signature is unchanged, so `ensure` keeps its cache check, its inflight
   * dedupe, its saves-settled wait and its RSC prime window exactly as they
   * were. All that changed is that N of these now cost one request instead of
   * N, and — because the server serves the whole batch through one memoizing
   * reader — one read per document instead of one subtree walk per document.
   * See `app/api/timelines/batch-get`.
   *
   * `ensure` already dedupes by id, so an id can appear at most once per
   * window; the queue does not need its own dedupe.
   *
   * ── What triggers a batch, measured rather than assumed ──────────────────
   *
   * Four triggers, one page load of a 151-document project each:
   *
   *   no batching (before)   58 requests, ~430 reads
   *   microtask              50 batches,   313 reads
   *   flush-on-in-flight     50 batches,   323 reads
   *   fixed 12ms timer       22 batches,   250 reads   <- this one
   *   fixed 60ms timer       23 batches,   300 reads
   *
   * The two "free" triggers coalesce NOTHING, and that is the finding: this
   * board hydrates card by card as the virtualizer mounts them, so consecutive
   * reads genuinely do not overlap. There is no burst to catch without waiting
   * for one. A microtask does not wait; neither does flushing when the previous
   * request lands, because by then the next card has not asked yet.
   *
   * So the window has to be a real delay, and 12ms is the size that paid: wider
   * was worse (60ms lost ground, presumably by holding the first read long
   * enough to delay the cascade behind it), and the delay is imperceptible on a
   * read nobody is waiting on.
   *
   * IT IS ALSO NOT THE REAL FIX. 250 reads for 151 documents still re-walks
   * shared subtrees across batches. What removes that is serving the closure
   * the server already loaded, so the client never asks per card at all.
   */
  const fetchDocument = (timelineId: string): Promise<TimelineDocument | null> =>
    new Promise((resolve) => {
      fetchQueue.push({ timelineId, resolve });
      if (!fetchScheduled) {
        fetchScheduled = true;
        scheduleBatch(flushFetchQueue);
      }
    });

  // Ids whose primes were declared INCOMING (expectPrimes), with the
  // deadline after which ensure stops waiting and fetches itself.
  const expectedPrimes = new Map<string, number>();

  /** Resolve with the primed document if it lands inside the expectation
   *  window, else null (caller falls back to its own fetch). */
  const awaitExpectedPrime = (timelineId: string): Promise<TimelineDocument | null> => {
    const deadline = expectedPrimes.get(timelineId);
    if (deadline === undefined || Date.now() >= deadline) {
      expectedPrimes.delete(timelineId);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (document: TimelineDocument | null) => {
        listeners.delete(check);
        if (timer !== null) clearTimeout(timer);
        expectedPrimes.delete(timelineId);
        resolve(document);
      };
      const check = () => {
        const cached = documents[timelineId];
        if (cached && !staleIds.has(timelineId)) settle(cached);
      };
      listeners.add(check);
      timer = setTimeout(() => settle(null), deadline - Date.now());
      check();
    });
  };

  /**
   * Resolves when the save pipeline is idle — nothing in flight AND nothing
   * queued behind it.
   *
   * A LOOP, not a single await, and that is the whole point. `settle()` starts
   * a TRAILING batch for edits that arrived mid-flight, and that batch is a
   * NEW promise: awaiting only the one that existed when we started resolves
   * the moment the FIRST batch lands, while the trailing POST is still on the
   * wire. A refresh that raced it read pre-save server state and — because the
   * response also carries a revision — installed that stale content as
   * current, so the queued edit could later be overwritten for good.
   *
   * Bounded rather than unbounded: each round costs a real network round-trip,
   * and a session editing continuously could otherwise keep a reader waiting
   * forever. On exhaustion we fall through and fetch anyway, which is no worse
   * than the behaviour this replaced.
   */
  const whenSavesSettled = async (): Promise<void> => {
    for (let round = 0; round < MAX_SAVE_DRAIN_ROUNDS; round += 1) {
      const inFlight = saveInFlight;
      if (inFlight === null) return;
      // The batch promise absorbs its own failures (see the handlers on it),
      // so this only ever waits — it never rethrows into the caller's chain.
      await inFlight.catch(() => undefined);
    }
  };

  /**
   * Does the session already hold every document under `rootId`, all of it
   * fresh?
   *
   * BOTH HALVES MATTER, and the second is the one with teeth. Holding the
   * documents is not enough: `refresh()` marks the whole cache stale on the
   * legacy boot precisely so they get refetched, because an edit made in
   * another view or another tab between graph sessions would otherwise be
   * overwritten by a full-document write built from stale content. Skipping the
   * fetch on presence alone would delete that protection — which is a data-loss
   * bug, not a slow path.
   *
   * A known-missing id resolves as an empty document, exactly as the server's
   * walk does, so a dangling `childTimelineId` does not make the closure look
   * permanently incomplete and refetch it forever.
   */
  const holdsFreshClosure = (rootId: string): boolean => {
    const seen = new Set<string>();
    const walk = (id: string): boolean => {
      if (seen.has(id)) return true;
      seen.add(id);
      if (!documents[id]) return knownMissingIds.has(id);
      if (staleIds.has(id)) return false;
      for (const clip of documents[id].clips) {
        if (clip.kind !== "collection" || !clip.childTimelineId) continue;
        if (!walk(clip.childTimelineId)) return false;
      }
      return true;
    };
    return walk(rootId);
  };

  /**
   * One closure request per root at a time.
   *
   * `holdsFreshClosure` is a check on STATE, so it cannot stop callers that
   * arrive before the first response lands — and they do: React runs an effect
   * twice in development, a re-render can re-run it, and the observed result
   * was FIVE identical closure POSTs within 30ms. Each one walks the whole
   * project, so that is 745 document reads to do a 149-read job. The
   * single-document `ensure` path has had this dedupe since #437; this is the
   * same guarantee for the closure.
   */
  const closureInflight = new Map<string, Promise<void>>();

  const ensureClosure = (rootId: string): Promise<void> => {
    if (holdsFreshClosure(rootId)) return Promise.resolve();
    const existing = closureInflight.get(rootId);
    if (existing) return existing;
    const run = runClosure(rootId).finally(() => {
      closureInflight.delete(rootId);
    });
    closureInflight.set(rootId, run);
    return run;
  };

  const runClosure = async (rootId: string): Promise<void> => {
    // NOTHING TO FETCH, so do not spend a walk finding that out.
    //
    // The server-primed boot arrives holding the whole closure already, and
    // asking again walked all 151 documents a SECOND time — measured at 465
    // reads against the 237 it was meant to beat (#437). The caller guards that
    // case too, by not calling this on a primed boot; this is the same
    // guarantee made STRUCTURAL rather than positional, so deleting the
    // caller's flag costs a redundant call rather than a doubled bill (#451).
    if (holdsFreshClosure(rootId)) return;

    const gen = generation;
    try {
      const response = await fetch("/api/timelines/closure", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: rootId }),
        cache: "no-store",
      });
      // A reset (auth rebind) happened while this was in flight, or the server
      // could not serve the closure. Either way this is best effort: say
      // nothing and let `ensure` do it the long way.
      if (gen !== generation || !response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as {
        results?: { id?: string; document?: TimelineDocument; revision?: number }[];
        missing?: string[];
      };
      if (gen !== generation) return;

      // KEEP THE MISSING LIST, which this used to discard.
      //
      // The server distinguishes two things the client otherwise cannot: a
      // document that is not loaded YET, and one that does not exist — a
      // dangling `childTimelineId` whose document was deleted. Its walk
      // substitutes an empty document for the second and reports the id here.
      //
      // Without that distinction, any consumer asking "do I hold the whole
      // closure?" has to answer no whenever a reference dangles, because an
      // unresolvable id looks identical to an unhydrated one. Recording them
      // lets `compileClientPlaybackManifest` substitute empties exactly where
      // the server does and still refuse on genuine gaps.
      for (const id of payload.missing ?? []) knownMissingIds.add(id);

      // Installed as PRIMES, through exactly the path an RSC payload uses. That
      // matters for more than tidiness: `installPrime` is what refuses a
      // payload for the wrong user, and what declines to overwrite a document
      // with unsaved local edits. A closure arriving mid-session must not
      // clobber work in progress, and reusing the prime path is what guarantees
      // it cannot.
      const next: Record<string, TimelineDocument> = { ...documents };
      let installed = 0;
      for (const entry of payload.results ?? []) {
        if (!entry.document || typeof entry.id !== "string") continue;
        if (entry.document.id !== entry.id) continue;
        // Never over a document this session has pending writes for.
        if (dirtyIds.has(entry.id) || saveInFlightIds.includes(entry.id)) continue;
        next[entry.id] = entry.document;
        if (typeof entry.revision === "number") revisions.set(entry.id, entry.revision);
        staleIds.delete(entry.id);
        setError(entry.id, null);
        installed += 1;
      }
      if (installed === 0) return;
      documents = next;
      notify();
    } catch {
      // Best effort — see the type. The ordinary path still works.
    }
  };

  const ensure = (timelineId: string): Promise<TimelineDocument | null> => {
    const cached = documents[timelineId];
    if (cached && !staleIds.has(timelineId)) return Promise.resolve(cached);
    // ALREADY ANSWERED: the server said this id does not exist.
    //
    // A dangling `childTimelineId` is normal — the reference stays in its
    // parent's clips after the document is gone — and the board asks for one
    // every time it hydrates the branch holding it. Measured on the real
    // project: five dangling ids fetched TWICE per page load, `POST batch-get`
    // at 158ms and 114ms, both answering 404 five times over. Against Firestore
    // that is ten document reads per load for five documents that do not exist.
    //
    // Bounded rather than permanent: `refresh()` clears the list, so entering
    // the view asks again and a document created since is picked up. Within one
    // session, an id the server has already denied is not asked for twice.
    if (!cached && knownMissingIds.has(timelineId)) return Promise.resolve(null);
    const pending = inflight.get(timelineId);
    if (pending) return pending;
    // A stale doc may still have writes in flight or queued (flushed on
    // refresh) — fetching before they ALL settle would read pre-save state.
    const request = whenSavesSettled()
      // An expected RSC prime gets a grace window to land before the
      // fallback fetch — the server is already streaming this document.
      .then(() => awaitExpectedPrime(timelineId))
      .then((primed) => primed ?? fetchDocument(timelineId))
      .then((document) => {
        if (document !== null) staleIds.delete(timelineId);
        return document;
      })
      .finally(() => {
        // Only evict OUR OWN entry. `reset()` (an auth rebind) clears the map
        // wholesale, so a request that started under the previous user could
        // otherwise settle later and delete the NEW session's entry for the
        // same id — leaving that request undeduplicated, so a second fetch
        // started and the two raced to install their responses.
        if (inflight.get(timelineId) === request) inflight.delete(timelineId);
      });
    inflight.set(timelineId, request);
    return request;
  };

  const scheduleFlush = (delayMs: number = SAVE_DEBOUNCE_MS) => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistBatch();
    }, delayMs);
  };

  const persistBatch = (options?: { keepalive?: boolean }) => {
    const wantsKeepalive = options?.keepalive === true;

    if (saveInFlight !== null) {
      if (!wantsKeepalive) {
        // Ordinary write during a flight: queue ONE trailing batch, which
        // will re-read the latest cache when the current one settles.
        saveQueued = true;
        return;
      }
      // Unload flush with a batch already running. Queuing behind it — what
      // this used to do — is what lost the last edit: the running request was
      // created WITHOUT keepalive, so page teardown kills it, and the
      // trailing batch that was waiting on its settle never starts at all.
      if (saveInFlightKeepalive && dirtyIds.size === 0) {
        // Already unload-safe and carrying everything: leave it alone.
        return;
      }
      // Abandon it and re-send its documents ourselves, from the latest
      // cache, in one unload-safe batch. Its `expectedRevision`s are still
      // valid: no response landed, so the revision ledger never advanced.
      // (If the server did process it before the abort, our batch loses CAS
      // and 409s — handled, and strictly better than not sending at all.)
      abandonSaveInFlight?.();
    }
    if (dirtyIds.size === 0) return;
    const writes: {
      document: TimelineDocument;
      expectedRevision?: number;
      allowEmptying?: boolean;
    }[] = [];
    for (const timelineId of dirtyIds) {
      const document = documents[timelineId];
      if (!document) continue;
      const revision = revisions.get(timelineId);
      // REMOVING THE LAST CLIP is a legal edit, and without this it is not:
      // the store refuses to write an empty document over a non-empty one
      // unless the write says the empty is deliberate. That escape reached the
      // MCP surface only, so the app could not empty a collection at all — and
      // a per-shot lane holds exactly one clip, so any correction to one hit it.
      //
      // Gated on `expectedRevision`, NOT set for every empty write. The guard
      // exists to stop a stale or half-loaded client wiping a document it never
      // really read; a write carrying a revision is CAS-protected against
      // exactly that, so an empty one is an edit rather than an accident. A
      // blind write (no revision known) still meets the guard, which is the
      // case worth keeping it for.
      //
      // Per-document too, never per-batch: a move empties its source while
      // filling its target, and only the source asked for the exemption.
      //
      // Read from `emptiedIds`, which records the moment clips went from some
      // to none, rather than asking "is this projection empty?" here. The two
      // differ for a document that was ALREADY empty and is being written for
      // another reason — a rename, or a resend — where the old test handed out
      // the exemption to a write that empties nothing. Harmless, since the
      // store's guard only fires against an existing non-empty document, but
      // it made the flag mean "happens to be empty" instead of "this write
      // empties it", and a flag that overstates what it permits is the kind
      // that gets widened later by someone reading it literally.
      const emptiesDocument = emptiedIds.has(timelineId) && revision !== undefined;
      writes.push({
        document,
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
        ...(emptiesDocument ? { allowEmptying: true } : {}),
      });
    }
    dirtyIds.clear();
    if (writes.length === 0) return;

    const gen = generation;
    const batchIds = writes.map((write) => write.document.id);
    let abandoned = false;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    abandonSaveInFlight = () => {
      abandoned = true;
      controller?.abort();
      // Put THIS batch's documents back in the dirty set so whatever replaces
      // it carries them too — nothing is dropped by abandoning a flight.
      for (const timelineId of batchIds) dirtyIds.add(timelineId);
      saveInFlight = null;
      saveInFlightKeepalive = false;
      saveInFlightIds = [];
      saveQueued = false;
      abandonSaveInFlight = null;
    };

    const settle = () => {
      // A reset (auth rebind) happened mid-flight, or an unload flush took
      // this batch over: either way this response belongs to a batch nobody
      // is waiting on — don't touch the state that replaced it.
      if (gen !== generation || abandoned) return;
      saveInFlight = null;
      saveInFlightKeepalive = false;
      saveInFlightIds = [];
      abandonSaveInFlight = null;
      notify();
      // Trailing batch: edits that landed mid-flight go out now, from the
      // latest cache.
      if (saveQueued) {
        saveQueued = false;
        persistBatch();
      }
    };

    // The project rides with the batch, not per write: a batch IS one board's
    // edit, and a cross-timeline move touches two documents that belong to the
    // same project. Omitted when unbound, which the server treats as "leave
    // whatever is stored alone".
    const body = JSON.stringify(
      boundProjectId === null ? { writes } : { writes, projectId: boundProjectId },
    );
    // The keepalive quota is 64 KiB across ALL in-flight keepalive requests,
    // and a request over it is not merely truncated — the fetch is a network
    // error, so asking for keepalive on an oversized body GUARANTEES the loss
    // it was meant to prevent. Splitting isn't an option either: this batch is
    // all-or-nothing by design. So send it as an ordinary request instead —
    // best effort, but it still lands whenever the page survives (the
    // visibilitychange case, most same-tab navigations) — and say so, rather
    // than failing silently.
    const overKeepaliveBudget = wantsKeepalive && byteLength(body) > KEEPALIVE_BUDGET_BYTES;
    if (overKeepaliveBudget) {
      for (const write of writes) {
        setError(
          write.document.id,
          `"${write.document.title}" is too large to be guaranteed a save while the page closes — keep this tab open until it saves.`,
        );
      }
    }

    saveInFlightIds = batchIds;
    saveInFlightKeepalive = wantsKeepalive && !overKeepaliveBudget;
    // The dirty set just moved into a flight: same total work, different
    // state, and the indicator distinguishes them.
    notify();
    saveInFlight = fetch("/api/timelines/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      ...(controller ? { signal: controller.signal } : {}),
      // keepalive lets the request outlive an unloading page (pagehide flush).
      // Not the default: it spends the shared 64 KiB quota above.
      ...(saveInFlightKeepalive ? { keepalive: true } : {}),
    })
      .then(
        async (response) => {
          if (gen !== generation || abandoned) return;
          if (response.ok) {
            const result = (await response.json().catch(() => ({}))) as {
              results?: { id: string; revision: number }[];
            };
            if (gen !== generation) return;
            lastSavedAt = Date.now();
            // Committed, so the intent is spent. Left set, a document emptied
            // once would carry the exemption for the rest of the session and
            // hand it to some later, unrelated write.
            for (const write of writes) emptiedIds.delete(write.document.id);
            for (const write of writes) setError(write.document.id, null);
            for (const entry of result.results ?? []) {
              if (typeof entry.revision === "number") revisions.set(entry.id, entry.revision);
            }
            return;
          }
          const result = (await response.json().catch(() => ({}))) as {
            error?: string;
            conflicts?: { id: string; actualRevision: number }[];
          };
          if (gen !== generation) return;
          const conflictIds = new Set((result.conflicts ?? []).map((entry) => entry.id));
          if (response.status === 409 && conflictIds.size > 0) {
            // Compare-and-set lost: someone else wrote these documents since
            // this session read them, and NOTHING in the batch was applied.
            // Conflicted documents are reloaded (fresh content + revision) —
            // the stale local write is NOT forced over the newer server state.
            //
            // Reloading fixes THIS CACHE ONLY. The live graph still holds the
            // pre-conflict local edit, and clip writes are whole-collection
            // projections of that graph — so "the user's next change
            // re-persists their intent", which is what this comment used to
            // claim, actually re-persists the entire stale collection against
            // the fresh revision and silently deletes the other writer's
            // additions. Further clip writes are therefore BLOCKED for these
            // ids until the graph is rebuilt from documents.
            //
            // THE WHOLE BATCH IS DROPPED, not just the conflicted ids.
            //
            // This used to re-queue the unconflicted writes and flush them on
            // their own, and that broke the all-or-nothing guarantee this
            // module's header promises — from the client side, after the server
            // had honoured it. A batch is one CHANGE: a move is
            // `[source −child, destination +child]`, a delete is
            // `[parent −child, trash +child]`. The server rejected the pair, so
            // re-sending the surviving half applies half a change — the source
            // loses the child and nothing gains it. That is an orphan, created
            // deliberately by the error path.
            //
            // The conflicted document reloads; the rest are blocked too,
            // because the change they belonged to no longer exists and their
            // projections came from the same now-suspect graph. Everything
            // lifts together on `refresh()`.
            for (const write of writes) {
              const timelineId = write.document.id;
              staleIds.add(timelineId);
              conflictedIds.add(timelineId);
              // Anything already queued for these ids was projected from the
              // stale graph too.
              dirtyIds.delete(timelineId);
              // The change this belonged to no longer exists, so neither does
              // the intent behind it. `refresh()` rebuilds from the server and
              // any re-emptying is recorded fresh.
              emptiedIds.delete(timelineId);
              if (!conflictIds.has(timelineId)) continue;
              // The message lands AFTER the reload (a successful fetch
              // clears that document's error slot — set before, it would
              // flash and vanish); it then stands until the document next
              // saves cleanly. A failed reload keeps its own load error.
              void ensure(timelineId).then((document) => {
                if (document !== null) {
                  setError(
                    timelineId,
                    `"${write.document.title}" changed in another view. Your unsaved edits to it are not being saved — reopen this timeline to continue editing.`,
                  );
                }
              });
            }
            if (dirtyIds.size > 0) scheduleFlush();
            return;
          }
          // A 4xx the conflict branch did not claim is TERMINAL. The server
          // rejected this payload on its merits — a malformed document, a bad
          // id, a bad expectedRevision, an empty-over-non-empty write, a
          // repeated id in one batch — so the SAME BYTES will be rejected
          // every time.
          //
          // Re-queueing them span forever. Worse, the ids stayed in `dirtyIds`,
          // so `hasPendingWrite` stayed true, so the preview's install guard
          // refused every compiled manifest and re-polled on its own timer:
          // two unbounded request loops on an idle tab, in every open tab,
          // from one permanent error that waiting could never fix.
          //
          // So end it the way the 409 above already does — stop retrying, block
          // further clip writes for these ids (a stale projection must not keep
          // re-sending), and say so. `refresh()` lifts the block once the graph
          // is rebuilt, which is the same recovery a conflict gets.
          if (response.status >= 400 && response.status < 500) {
            for (const write of writes) {
              // COMPOSED, never the server's string alone. Its reason is the
              // useful part ("Every batch write needs a valid timeline
              // document.") but it describes the payload, not the consequence
              // — and the consequence is the bit the user has to act on: this
              // is not going to retry, so waiting is not a plan. Same shape as
              // the conflict message above, for the same reason.
              const reason =
                result.error ?? `the server rejected it (${response.status})`;
              setError(
                write.document.id,
                `"${write.document.title}" could not be saved: ${reason} Your unsaved edits to it are not being saved — reopen this timeline to continue editing.`,
              );
              dirtyIds.delete(write.document.id);
              conflictedIds.add(write.document.id);
            }
            notify();
            return;
          }

          // 5xx and anything else: genuinely transient, so surface it AND
          // re-queue — clearing dirtyIds before the request must not
          // permanently drop the change when the server balks. The slower
          // retry cadence keeps a struggling server from being hammered, and
          // re-dirtied ids ride any later unload flush.
          for (const write of writes) {
            setError(
              write.document.id,
              result.error ?? `Saving "${write.document.title}" failed (${response.status}).`,
            );
            dirtyIds.add(write.document.id);
          }
          scheduleFlush(SAVE_RETRY_MS);
        },
        (cause: unknown) => {
          // `abandoned` covers the abort we issued ourselves: its documents
          // are already back in `dirtyIds` and travelling in the replacement
          // batch, so reporting a failure here would be a lie.
          if (gen !== generation || abandoned) return;
          // Network failure: same re-queue + slow retry as above.
          for (const write of writes) {
            setError(
              write.document.id,
              cause instanceof Error ? cause.message : `Saving "${write.document.title}" failed.`,
            );
            dirtyIds.add(write.document.id);
          }
          scheduleFlush(SAVE_RETRY_MS);
        },
      )
      .then(settle, settle);
  };

  const flushPendingWrites = (options?: { keepalive?: boolean }) => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistBatch(options);
  };

  if (typeof window !== "undefined") {
    // Closing or backgrounding the tab inside the debounce window must not
    // lose the last edit. pagehide is the unload signal; hidden visibility
    // additionally covers mobile tab kills (and an early flush is harmless).
    window.addEventListener("pagehide", () => flushPendingWrites({ keepalive: true }));
    window.addEventListener("visibilitychange", () => {
      if (window.document.visibilityState === "hidden") {
        flushPendingWrites({ keepalive: true });
      }
    });
  }

  // The guarded install shared by `prime` (once bound) and `bindUser`'s
  // replay of held payloads. Refuses anything not for the bound user, and
  // never clobbers a local edit or regresses the revision ledger.
  const installPrime = (document: TimelineDocument, revision: number, forUid: string) => {
    const timelineId = document.id;
    if (boundUid === null || forUid !== boundUid) return;
    // It exists after all, so stop shadowing it. A document can be created at
    // an id this session already asked about — the negative answer must not
    // outlive the evidence against it.
    knownMissingIds.delete(timelineId);
    // Local edits win: a dirty document (or any batch mid-flight, whose write
    // set isn't inspectable here) must not be replaced by a server read that
    // predates it.
    if (dirtyIds.has(timelineId) || saveInFlight !== null) return;
    const known = revisions.get(timelineId);
    if (known !== undefined && revision < known) return;
    if (documents[timelineId] !== undefined && known === revision) {
      // Same version already cached — just confirm freshness.
      staleIds.delete(timelineId);
      return;
    }
    documents = { ...documents, [timelineId]: document };
    revisions.set(timelineId, revision);
    staleIds.delete(timelineId);
    setError(timelineId, null);
    notify();
  };

  return {
    read: () => documents,
    readServerSnapshot: () => EMPTY_DOCUMENTS,
    peek: (timelineId) => documents[timelineId] ?? null,
    ensure,
    ensureClosure,
    writeClips: (timelineId, clips) => {
      const document = documents[timelineId];
      if (!document) return;
      // THE chokepoint for the conflict gate — every clip writer goes through
      // here, so blocking at the caller alone would leave the next one to
      // rediscover the hazard. A conflicted document's cache is fresh but the
      // GRAPH these clips were projected from is not; writing them would
      // overwrite the other writer's content with a stale full collection.
      if (conflictedIds.has(timelineId)) return;
      // THE TRANSITION, recorded where it is visible. This is the only place
      // both the previous clips and the new ones are in hand; by flush time
      // the old ones are gone and all that is left is "it is empty now",
      // which is a different question. Re-filling clears it, so an empty
      // followed by an undo in the same window asks for no exemption.
      if (clips.length === 0 && document.clips.length > 0) emptiedIds.add(timelineId);
      else if (clips.length > 0) emptiedIds.delete(timelineId);
      documents = { ...documents, [timelineId]: { ...document, clips } };
      notify();
      dirtyIds.add(timelineId);
      scheduleFlush();
    },
    renameTimeline: async (timelineId, title) => {
      const gen = generation;
      // The child document is the source of truth for the name — load it if
      // this row hasn't been hydrated yet, so the title write actually lands.
      if (!documents[timelineId]) await ensure(timelineId);
      // A reset (auth rebind) happened mid-load: don't resurrect a stale doc.
      if (gen !== generation) return;
      const current = documents[timelineId];
      if (!current || current.title === title) return;
      documents = { ...documents, [timelineId]: { ...current, title } };
      notify();
      dirtyIds.add(timelineId);
      scheduleFlush();
    },
    setRenderFormat: async (timelineId, format) => {
      const gen = generation;
      if (!documents[timelineId]) await ensure(timelineId);
      if (gen !== generation) return;
      const current = documents[timelineId];
      if (!current) return;
      // Defended on the way in, so a bad value cannot reach ffmpeg through the
      // stored document — and `null` clears the field rather than storing a
      // default, since absence IS the default everywhere in this model.
      const next = format === null ? undefined : renderFormatOf(format);
      if (format !== null && next === undefined) return;
      const unchanged =
        next === undefined
          ? current.renderFormat === undefined
          : current.renderFormat !== undefined && sameRenderFormat(current.renderFormat, next);
      if (unchanged) return;
      const { renderFormat: _dropped, ...rest } = current;
      documents = {
        ...documents,
        [timelineId]: next === undefined ? rest : { ...rest, renderFormat: next },
      };
      notify();
      dirtyIds.add(timelineId);
      scheduleFlush();
    },
    seed: (document) => {
      if (documents[document.id]) return;
      documents = { ...documents, [document.id]: document };
      // Expectation 0: the batch write that first persists this document is
      // a compare-and-set CREATE — a same-id document appearing on the
      // server meanwhile conflicts instead of being overwritten.
      revisions.set(document.id, 0);
      notify();
    },
    prime: (document, revision, forUid) => {
      // Not bound yet: hold the payload rather than dropping it (a stale RSC
      // prop surviving an auth transition would otherwise never warm the
      // cache). bindUser replays these, discarding any not for the new user.
      if (boundUid === null) {
        pendingPrimes.push({ document, revision, forUid });
        return;
      }
      installPrime(document, revision, forUid);
    },
    expectPrimes: (ids, windowMs = PRIME_WAIT_MS) => {
      const deadline = Date.now() + windowMs;
      for (const id of ids) {
        // Only ids the cache can't serve — a fresh cached doc never waits.
        if (documents[id] !== undefined && !staleIds.has(id)) continue;
        expectedPrimes.set(id, deadline);
      }
    },
    bindProject: (projectId) => {
      boundProjectId = projectId;
    },
    bindUser: (uid) => {
      if (boundUid === uid) return;
      const hadUser = boundUid !== null;
      boundUid = uid;
      // A DIFFERENT user resets everything (reset() also clears pendingPrimes);
      // the first bind keeps the payloads that arrived while unbound.
      if (hadUser) reset();
      const held = pendingPrimes;
      pendingPrimes = [];
      for (const payload of held) installPrime(payload.document, payload.revision, payload.forUid);
    },
    revisionOf: (timelineId) => revisions.get(timelineId),
    hasPendingWrite: (timelineId) =>
      dirtyIds.has(timelineId) || saveInFlightIds.includes(timelineId),
    isConflicted: (timelineId) => conflictedIds.has(timelineId),
    isKnownMissing: (timelineId) => knownMissingIds.has(timelineId),
    recordMissing: (ids) => {
      for (const id of ids) knownMissingIds.add(id);
    },
    markGraphBehind: (timelineId, reason) => {
      if (documents[timelineId] === undefined) return;
      if (conflictedIds.has(timelineId)) return;
      conflictedIds.add(timelineId);
      setError(
        timelineId,
        `"${documents[timelineId]?.title ?? timelineId}" changed in another view and this board could not merge it. Its edits are not being saved — reopen this timeline to continue. (${reason})`,
      );
      notify();
    },
    saveState: readSaveState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastError: () => errorBanner,
    reportIssue: (key, message) => setError(key, message),
    flushPendingWrites,
    markStale: (timelineId) => {
      // Named by the revisions endpoint, so it exists — clear the negative
      // answer even for an id this session never held.
      knownMissingIds.delete(timelineId);
      if (documents[timelineId] === undefined) return;
      staleIds.add(timelineId);
    },
    refresh: () => {
      flushPendingWrites();
      staleIds = new Set(Object.keys(documents));
      // WHAT WAS MISSING IS RE-CHECKED. `ensure` skips a known-missing id
      // outright, so without this a document created elsewhere between graph
      // sessions would stay invisible for the life of the tab — the same
      // don't-trust-the-session-cache reasoning that marks everything stale
      // here, applied to the absences rather than the documents.
      knownMissingIds.clear();
      // Entering the graph view rebuilds the graph from freshly fetched
      // documents, which is exactly the reconciliation the conflict gate was
      // waiting for — so the block lifts here and nowhere else.
      conflictedIds = new Set();
    },
  };
}

/** One cache per browser session — drill-ins and view switches share it. */
export const graphDocumentsGateway = createGraphDocumentsGateway();
