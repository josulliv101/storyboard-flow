import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
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

export type GraphDocumentsGateway = Readonly<{
  /** Snapshot of every document the session has loaded or written. */
  read: () => DocumentsById;
  /** The document if already cached, without triggering IO. */
  peek: (timelineId: string) => TimelineDocument | null;
  /**
   * Cached document, or fetch-and-cache it. Concurrent calls for the same
   * id share one request. Resolves null when the API has no such timeline
   * (or the request failed — surfaced via `lastError`).
   */
  ensure: (timelineId: string) => Promise<TimelineDocument | null>;
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
  /** The compare-and-set ledger's revision for a document, if known. */
  revisionOf: (timelineId: string) => number | undefined;
  /** Cache-change notifications (documents landing, clips written). */
  subscribe: (listener: () => void) => () => void;
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
}>;

export function createGraphDocumentsGateway(): GraphDocumentsGateway {
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
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // At most one batch in flight; a write requested meanwhile queues one
  // trailing batch that re-reads the latest cache. Without this, an older
  // in-flight batch could reach the server after a newer one and win.
  let saveInFlight: Promise<void> | null = null;
  let saveQueued = false;
  // A queued trailing batch remembers whether any flush that requested it
  // needed keepalive (pagehide) — dropping that bit would send the trailing
  // batch as an ordinary fetch during page teardown.
  let saveQueuedKeepalive = false;
  // Ids whose cached content predates the current graph session (see
  // `refresh`) or lost a revision conflict: readable, but `ensure`
  // refetches them.
  let staleIds = new Set<string>();
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
    dirtyIds.clear();
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveInFlight = null;
    saveQueued = false;
    saveQueuedKeepalive = false;
    staleIds = new Set();
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

  const fetchDocument = async (timelineId: string): Promise<TimelineDocument | null> => {
    const gen = generation;
    try {
      const response = await fetch(`/api/timelines/${encodeURIComponent(timelineId)}`, {
        cache: "no-store",
      });
      // A reset (auth rebind) happened while this was in flight: the
      // response belongs to the previous session and must not land.
      if (gen !== generation) return null;
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (gen !== generation) return null;
        setError(
          timelineId,
          result.error || `Timeline "${timelineId}" failed to load (${response.status}).`,
        );
        return null;
      }
      const result = (await response.json().catch(() => ({}))) as {
        document?: TimelineDocument;
        revision?: number;
      };
      if (gen !== generation) return null;
      if (!result.document || result.document.id !== timelineId) {
        setError(timelineId, `Timeline "${timelineId}" returned an unexpected document.`);
        return null;
      }
      documents = { ...documents, [timelineId]: result.document };
      if (typeof result.revision === "number") {
        revisions.set(timelineId, result.revision);
      } else {
        // No revision from the server: drop any stale expectation rather
        // than let it force spurious conflicts.
        revisions.delete(timelineId);
      }
      setError(timelineId, null);
      notify();
      return result.document;
    } catch (cause) {
      if (gen !== generation) return null;
      setError(
        timelineId,
        cause instanceof Error ? cause.message : `Timeline "${timelineId}" failed to load.`,
      );
      return null;
    }
  };

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

  const ensure = (timelineId: string): Promise<TimelineDocument | null> => {
    const cached = documents[timelineId];
    if (cached && !staleIds.has(timelineId)) return Promise.resolve(cached);
    const pending = inflight.get(timelineId);
    if (pending) return pending;
    // A stale doc may still have a batch in flight (flushed on refresh) —
    // fetching before it settles would read the pre-save server state.
    const settled = saveInFlight ?? Promise.resolve();
    const request = settled
      // An expected RSC prime gets a grace window to land before the
      // fallback fetch — the server is already streaming this document.
      .then(() => awaitExpectedPrime(timelineId))
      .then((primed) => primed ?? fetchDocument(timelineId))
      .then((document) => {
        if (document !== null) staleIds.delete(timelineId);
        return document;
      })
      .finally(() => {
        inflight.delete(timelineId);
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
    if (saveInFlight !== null) {
      saveQueued = true;
      // The trailing batch must keep the strongest delivery requirement any
      // caller asked for — a pagehide flush queued behind a running save
      // still needs keepalive or the browser may kill it on teardown.
      if (options?.keepalive) saveQueuedKeepalive = true;
      return;
    }
    if (dirtyIds.size === 0) return;
    const writes: { document: TimelineDocument; expectedRevision?: number }[] = [];
    for (const timelineId of dirtyIds) {
      const document = documents[timelineId];
      if (!document) continue;
      const revision = revisions.get(timelineId);
      writes.push({
        document,
        ...(revision !== undefined ? { expectedRevision: revision } : {}),
      });
    }
    dirtyIds.clear();
    if (writes.length === 0) return;

    const gen = generation;
    const settle = () => {
      // A reset (auth rebind) happened mid-flight: this batch belongs to
      // the previous session — don't touch the new one's state.
      if (gen !== generation) return;
      saveInFlight = null;
      // Trailing batch: edits that landed mid-flight go out now, from the
      // latest cache — carrying a queued keepalive requirement forward.
      if (saveQueued) {
        saveQueued = false;
        const keepalive = saveQueuedKeepalive;
        saveQueuedKeepalive = false;
        persistBatch(keepalive ? { keepalive: true } : undefined);
      }
    };

    saveInFlight = fetch("/api/timelines/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
      // keepalive lets the request outlive an unloading page (pagehide
      // flush). Not the default: keepalive bodies are capped (~64KB).
      ...(options?.keepalive ? { keepalive: true } : {}),
    })
      .then(
        async (response) => {
          if (gen !== generation) return;
          if (response.ok) {
            const result = (await response.json().catch(() => ({}))) as {
              results?: { id: string; revision: number }[];
            };
            if (gen !== generation) return;
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
            // the stale local write is NOT forced over the newer server
            // state. The graph still holds the local edit, so the user's
            // next change re-persists their intent against the fresh
            // revision. Unconflicted writes from the batch re-queue as-is.
            for (const write of writes) {
              const timelineId = write.document.id;
              if (conflictIds.has(timelineId)) {
                staleIds.add(timelineId);
                // The message lands AFTER the reload (a successful fetch
                // clears that document's error slot — set before, it would
                // flash and vanish); it then stands until the document next
                // saves cleanly. A failed reload keeps its own load error.
                void ensure(timelineId).then((document) => {
                  if (document !== null) {
                    setError(
                      timelineId,
                      `"${write.document.title}" changed in another view — reloaded it; the last edit here was not saved.`,
                    );
                  }
                });
              } else {
                dirtyIds.add(timelineId);
              }
            }
            if (dirtyIds.size > 0) scheduleFlush();
            return;
          }
          // Non-conflict failure (5xx, 400…): surface it AND re-queue —
          // clearing dirtyIds before the request must not permanently drop
          // the change when the server balks. The slower retry cadence
          // keeps a struggling server from being hammered, and re-dirtied
          // ids ride any later unload flush.
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
          if (gen !== generation) return;
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
    peek: (timelineId) => documents[timelineId] ?? null,
    ensure,
    writeClips: (timelineId, clips) => {
      const document = documents[timelineId];
      if (!document) return;
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
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastError: () => errorBanner,
    reportIssue: (key, message) => setError(key, message),
    flushPendingWrites,
    refresh: () => {
      flushPendingWrites();
      staleIds = new Set(Object.keys(documents));
    },
  };
}

/** One cache per browser session — drill-ins and view switches share it. */
export const graphDocumentsGateway = createGraphDocumentsGateway();
