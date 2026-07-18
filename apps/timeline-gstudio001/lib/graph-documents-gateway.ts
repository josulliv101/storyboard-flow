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
   * Insert a BRAND-NEW document into the cache (a collection minted
   * client-side, e.g. a sidebar-tool drop) with an expected revision of 0 —
   * the first write is a compare-and-set CREATE, so it can never clobber a
   * document that turns out to exist. No-op when the id is already cached.
   */
  seed: (document: TimelineDocument) => void;
  /** Cache-change notifications (documents landing, clips written). */
  subscribe: (listener: () => void) => () => void;
  /** Outstanding load/save failures, for a status banner. Null when every
   *  document is healthy; multiple failures are all listed. */
  lastError: () => string | null;
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
  // Ids whose cached content predates the current graph session (see
  // `refresh`) or lost a revision conflict: readable, but `ensure`
  // refetches them.
  let staleIds = new Set<string>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
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
    try {
      const response = await fetch(`/api/timelines/${encodeURIComponent(timelineId)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
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
      setError(
        timelineId,
        cause instanceof Error ? cause.message : `Timeline "${timelineId}" failed to load.`,
      );
      return null;
    }
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
      .then(() => fetchDocument(timelineId))
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

  const scheduleFlush = () => {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistBatch();
    }, SAVE_DEBOUNCE_MS);
  };

  const persistBatch = (options?: { keepalive?: boolean }) => {
    if (saveInFlight !== null) {
      saveQueued = true;
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

    const settle = () => {
      saveInFlight = null;
      // Trailing batch: edits that landed mid-flight go out now, from the
      // latest cache.
      if (saveQueued) {
        saveQueued = false;
        persistBatch();
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
          if (response.ok) {
            const result = (await response.json().catch(() => ({}))) as {
              results?: { id: string; revision: number }[];
            };
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
          for (const write of writes) {
            setError(
              write.document.id,
              result.error ?? `Saving "${write.document.title}" failed (${response.status}).`,
            );
          }
        },
        (cause: unknown) => {
          for (const write of writes) {
            setError(
              write.document.id,
              cause instanceof Error ? cause.message : `Saving "${write.document.title}" failed.`,
            );
          }
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
    seed: (document) => {
      if (documents[document.id]) return;
      documents = { ...documents, [document.id]: document };
      // Expectation 0: the batch write that first persists this document is
      // a compare-and-set CREATE — a same-id document appearing on the
      // server meanwhile conflicts instead of being overwritten.
      revisions.set(document.id, 0);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lastError: () => errorBanner,
    flushPendingWrites,
    refresh: () => {
      flushPendingWrites();
      staleIds = new Set(Object.keys(documents));
    },
  };
}

/** One cache per browser session — drill-ins and view switches share it. */
export const graphDocumentsGateway = createGraphDocumentsGateway();
