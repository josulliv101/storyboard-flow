import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";
import type { DocumentsById } from "@storyboard/timeline-domain";

// The graph view's ONLY coupling to persistence: the same
// GET/PATCH /api/timelines/[id] contract the legacy SmoothScrollList views
// speak (auth-gated, per-user Firebase behind it), fronted by an in-memory
// session cache. The graph provider replaces the legacy
// TimelineDocumentsProvider's consistency role wholesale, so this gateway
// deliberately does NOT touch that store — one storage contract, two
// independent view systems, which is what lets the graph view ship without
// modifying storyboard/workbench.
//
// Reads are synchronous against the cache (the timeline-domain adapter takes
// a DocumentsById snapshot); `ensure` is the async fill (hydrate-on-focus
// IO); `writeClips` is the patch-scoped write path — cache immediately,
// PATCH debounced per timeline like the legacy autosave.

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
   * The patch-scoped write path: update the cached document's clips now,
   * PATCH the API after a debounce (per timeline — rapid edits coalesce).
   * No-op for timelines the session hasn't loaded.
   */
  writeClips: (timelineId: string, clips: TimelineClip[]) => void;
  /** Cache-change notifications (documents landing, clips written). */
  subscribe: (listener: () => void) => () => void;
  /** Outstanding load/save failures, for a status banner. Null when every
   *  document is healthy; multiple failures are all listed. */
  lastError: () => string | null;
  /**
   * Send every debounce-pending write NOW. Called on pagehide/hidden (with
   * keepalive, so the requests survive the tab closing) and before a
   * refresh — closing the tab inside the debounce window must not lose the
   * last edit.
   */
  flushPendingWrites: (options?: { keepalive?: boolean }) => void;
  /**
   * Entering the graph view calls this: every cached document is marked
   * STALE, so `ensure` refetches it (after any in-flight save settles)
   * instead of trusting the session cache. Without it, edits made in the
   * storyboard view (or another tab) between graph sessions would be
   * overwritten by the next full-document PATCH built from stale content.
   * Cached content stays readable until the refetch lands.
   */
  refresh: () => void;
}>;

export function createGraphDocumentsGateway(): GraphDocumentsGateway {
  let documents: DocumentsById = {};
  // Errors are PER DOCUMENT: a successful write of one timeline must never
  // clear (and thereby hide) another timeline's failed save — with a single
  // last-error string, whichever request resolved last won.
  const errors = new Map<string, string>();
  let errorBanner: string | null = null;
  const inflight = new Map<string, Promise<TimelineDocument | null>>();
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Writes are SERIALIZED per document: at most one PATCH in flight, and a
  // write requested meanwhile is queued to run after it — always carrying
  // the LATEST cached document. Without this, an older in-flight PATCH
  // could reach the server after a newer one and win.
  const savesInFlight = new Map<string, Promise<void>>();
  const saveQueued = new Set<string>();
  // Ids whose cached content predates the current graph session (see
  // `refresh`): readable, but `ensure` refetches them.
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
      };
      if (!result.document || result.document.id !== timelineId) {
        setError(timelineId, `Timeline "${timelineId}" returned an unexpected document.`);
        return null;
      }
      documents = { ...documents, [timelineId]: result.document };
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

  const persist = (timelineId: string, options?: { keepalive?: boolean }) => {
    if (savesInFlight.has(timelineId)) {
      saveQueued.add(timelineId);
      return;
    }
    const document = documents[timelineId];
    if (!document) return;
    const flight = fetch(`/api/timelines/${encodeURIComponent(timelineId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document }),
      // keepalive lets the request outlive an unloading page (pagehide
      // flush). Not the default: keepalive bodies are capped (~64KB).
      ...(options?.keepalive ? { keepalive: true } : {}),
    }).then(
      (response) => {
        if (!response.ok) {
          setError(timelineId, `Saving "${document.title}" failed (${response.status}).`);
        } else {
          setError(timelineId, null);
        }
      },
      (cause: unknown) => {
        setError(
          timelineId,
          cause instanceof Error ? cause.message : `Saving "${document.title}" failed.`,
        );
      },
    );
    savesInFlight.set(
      timelineId,
      flight.then(() => {
        savesInFlight.delete(timelineId);
        // Trailing write: edits that landed mid-flight go out now, from the
        // latest cache.
        if (saveQueued.delete(timelineId)) persist(timelineId);
      }),
    );
  };

  const flushPendingWrites = (options?: { keepalive?: boolean }) => {
    for (const [timelineId, timer] of [...saveTimers]) {
      clearTimeout(timer);
      saveTimers.delete(timelineId);
      persist(timelineId, options);
    }
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
    ensure: (timelineId) => {
      const cached = documents[timelineId];
      if (cached && !staleIds.has(timelineId)) return Promise.resolve(cached);
      const pending = inflight.get(timelineId);
      if (pending) return pending;
      // A stale doc may still have a save in flight (flushed on refresh) —
      // fetching before it settles would read the pre-save server state.
      const settled = savesInFlight.get(timelineId) ?? Promise.resolve();
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
    },
    writeClips: (timelineId, clips) => {
      const document = documents[timelineId];
      if (!document) return;
      documents = { ...documents, [timelineId]: { ...document, clips } };
      notify();
      const timer = saveTimers.get(timelineId);
      if (timer !== undefined) clearTimeout(timer);
      saveTimers.set(
        timelineId,
        setTimeout(() => {
          saveTimers.delete(timelineId);
          persist(timelineId);
        }, SAVE_DEBOUNCE_MS),
      );
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
