import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { createGraphDocumentsGateway } from "./graph-documents-gateway";

const SAVE_DEBOUNCE_MS = 900;
const SAVE_RETRY_MS = 5000;

function clip(id: string, startTime = 0): TimelineClip {
  return {
    id,
    index: 0,
    kind: "video",
    src: `https://cdn.test/${id}.mp4`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  };
}

function doc(id: string, clips: TimelineClip[] = []): TimelineDocument {
  return { id, title: `Timeline ${id}`, clips };
}

type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function jsonResponse(body: unknown, status = 200): MockResponse {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type BatchWrite = { document: TimelineDocument; expectedRevision?: number };

type FetchCall = {
  method: string;
  /** GET: the timeline id from the url. POST: "batch". */
  id: string;
  writes?: BatchWrite[];
  keepalive?: boolean;
  /** Kept so tests can assert a batch was abandoned (unload takeover). */
  signal?: AbortSignal;
  /** Serialized request body length, for keepalive-budget assertions. */
  bodyBytes?: number;
};

/** Stubs global fetch; returns the recorded calls for assertions. */
function installFetch(handler: (call: FetchCall) => Promise<MockResponse> | MockResponse) {
  const calls: FetchCall[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      method: init?.method ?? "GET",
      id: decodeURIComponent(String(input).split("/").pop() ?? ""),
      writes:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { writes: BatchWrite[] }).writes
          : undefined,
      keepalive: init?.keepalive,
      signal: init?.signal ?? undefined,
      bodyBytes:
        typeof init?.body === "string" ? new TextEncoder().encode(init.body).length : undefined,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return calls;
}

const batchesOf = (calls: FetchCall[]) => calls.filter((call) => call.method === "POST");
const getsOf = (calls: FetchCall[], id?: string) =>
  calls.filter((call) => call.method === "GET" && (id === undefined || call.id === id));
const clipIds = (document: TimelineDocument | null | undefined) =>
  document?.clips.map((entry) => entry.id);
/** results payload echoing each write's next revision (expected + 1). */
const okResults = (writes: BatchWrite[] = []) =>
  jsonResponse({
    results: writes.map((write) => ({
      id: write.document.id,
      revision: (write.expectedRevision ?? 0) + 1,
    })),
  });

describe("graph-documents-gateway", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ensure fetches once, dedupes concurrent calls, and serves the cache afterward", async () => {
    const calls = installFetch(() =>
      jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();

    const [first, second] = await Promise.all([gateway.ensure("a"), gateway.ensure("a")]);
    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(getsOf(calls)).toHaveLength(1);

    await gateway.ensure("a");
    expect(getsOf(calls)).toHaveLength(1);
    expect(clipIds(gateway.peek("a"))).toEqual(["a1"]);
  });

  it("writeClips is a no-op for documents the session has not loaded", async () => {
    const calls = installFetch(() => jsonResponse({}));
    const gateway = createGraphDocumentsGateway();

    gateway.writeClips("ghost", [clip("g1")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(calls).toHaveLength(0);
  });

  it("one debounce window: several dirty documents flush as ONE batch carrying their expected revisions", async () => {
    const revisionOf = new Map([
      ["a", 3],
      ["b", 7],
    ]);
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({
            document: doc(call.id, [clip(`${call.id}-seed`)]),
            revision: revisionOf.get(call.id) ?? 0,
          }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    await gateway.ensure("b");

    gateway.writeClips("a", [clip("a2")]);
    gateway.writeClips("b", [clip("b2")]);
    expect(batchesOf(calls)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const batches = batchesOf(calls);
    expect(batches).toHaveLength(1);
    expect(batches[0].writes).toHaveLength(2);
    const byId = new Map(batches[0].writes?.map((write) => [write.document.id, write]));
    expect(clipIds(byId.get("a")?.document)).toEqual(["a2"]);
    expect(byId.get("a")?.expectedRevision).toBe(3);
    expect(clipIds(byId.get("b")?.document)).toEqual(["b2"]);
    expect(byId.get("b")?.expectedRevision).toBe(7);

    // The batch result advanced the revision ledger: the next write for "a"
    // expects 4, not 3.
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const second = batchesOf(calls)[1];
    expect(second.writes).toHaveLength(1);
    expect(second.writes?.[0].expectedRevision).toBe(4);
  });

  it("serializes batches: writes during a flight queue one trailing batch with the latest cache", async () => {
    const firstSave = deferred<MockResponse>();
    let batchCount = 0;
    const calls = installFetch((call) => {
      if (call.method !== "POST") {
        return jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 });
      }
      batchCount += 1;
      return batchCount === 1 ? firstSave.promise : okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // in flight, unresolved

    gateway.writeClips("a", [clip("a3")]);
    gateway.writeClips("a", [clip("a4")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // queued, not raced

    firstSave.resolve(jsonResponse({ results: [{ id: "a", revision: 2 }] }));
    await vi.advanceTimersByTimeAsync(0);
    const batches = batchesOf(calls);
    expect(batches).toHaveLength(2);
    expect(clipIds(batches[1].writes?.[0].document)).toEqual(["a4"]);
    expect(batches[1].writes?.[0].expectedRevision).toBe(2);
  });

  // The refresh/save race. Awaiting only the batch that happened to be in
  // flight resolves the moment IT lands — while the trailing batch, carrying
  // the edit that arrived mid-flight, is still on the wire. The read then
  // returns pre-save content AND a revision, so the stale version installs as
  // current and a later whole-document write can overwrite the queued edit for
  // good.
  it("a refresh waits out the TRAILING batch too, not just the one in flight", async () => {
    const firstSave = deferred<MockResponse>();
    const secondSave = deferred<MockResponse>();
    let batchCount = 0;
    const calls = installFetch((call) => {
      if (call.method !== "POST") {
        return jsonResponse({ document: doc("a", [clip("from-server")]), revision: 9 });
      }
      batchCount += 1;
      if (batchCount === 1) return firstSave.promise;
      if (batchCount === 2) return secondSave.promise;
      return okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    expect(getsOf(calls, "a")).toHaveLength(1);

    // Save A goes out…
    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);

    // …an edit lands WHILE it is in flight, so a trailing batch is queued…
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);

    // …and the view refreshes, which marks everything stale and re-reads.
    gateway.refresh();
    const refreshed = gateway.ensure("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(getsOf(calls, "a")).toHaveLength(1);

    // Save A lands and the TRAILING batch starts. THIS is the moment the old
    // code fetched: its awaited promise had resolved, so the GET raced batch B.
    firstSave.resolve(jsonResponse({ results: [{ id: "a", revision: 2 }] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(batchesOf(calls)).toHaveLength(2);
    expect(getsOf(calls, "a")).toHaveLength(1);

    // Only once the pipeline is genuinely idle does the read go out.
    secondSave.resolve(jsonResponse({ results: [{ id: "a", revision: 3 }] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(getsOf(calls, "a")).toHaveLength(2);
    expect(clipIds(await refreshed)).toEqual(["from-server"]);
  });

  it("flushPendingWrites sends the pending batch immediately, with keepalive", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    gateway.flushPendingWrites({ keepalive: true });
    const batches = batchesOf(calls);
    expect(batches).toHaveLength(1);
    expect(batches[0].keepalive).toBe(true);
    expect(clipIds(batches[0].writes?.[0].document)).toEqual(["a2"]);

    // The debounce timer was consumed — no duplicate batch later.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);
  });

  // The unload path. A keepalive flush must never wait on a request that
  // page teardown is about to kill — queuing behind it is how the last edit
  // was lost.
  it("an unload flush takes over a running non-keepalive save instead of queuing behind it", async () => {
    const stuckSave = deferred<MockResponse>(); // never settles: the page is closing
    let batchCount = 0;
    const calls = installFetch((call) => {
      if (call.method !== "POST") {
        return jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 });
      }
      batchCount += 1;
      return batchCount === 1 ? stuckSave.promise : okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // in flight, will never settle

    // An edit lands mid-flight, then the tab starts closing.
    gateway.writeClips("a", [clip("a3")]);
    gateway.flushPendingWrites({ keepalive: true });

    const batches = batchesOf(calls);
    expect(batches).toHaveLength(2); // it did NOT wait for the stuck request
    expect(batches[0].signal?.aborted).toBe(true); // the stuck one was abandoned
    expect(batches[1].keepalive).toBe(true);
    // Carries the LATEST cache, and still expects the revision the abandoned
    // batch expected — no response landed, so the ledger never advanced.
    expect(clipIds(batches[1].writes?.[0].document)).toEqual(["a3"]);
    expect(batches[1].writes?.[0].expectedRevision).toBe(1);
    // Abandoning is not a failure: it must not surface as a save error.
    expect(gateway.lastError()).toBeNull();
  });

  it("an unload flush re-sends an in-flight batch even with nothing newly dirty", async () => {
    const stuckSave = deferred<MockResponse>();
    let batchCount = 0;
    const calls = installFetch((call) => {
      if (call.method !== "POST") {
        return jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 });
      }
      batchCount += 1;
      return batchCount === 1 ? stuckSave.promise : okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    gateway.flushPendingWrites({ keepalive: true });

    // The in-flight batch's own content is what would have been lost.
    const batches = batchesOf(calls);
    expect(batches).toHaveLength(2);
    expect(batches[1].keepalive).toBe(true);
    expect(clipIds(batches[1].writes?.[0].document)).toEqual(["a2"]);
  });

  it("a second unload flush leaves an already-keepalive batch alone", async () => {
    const stuckSave = deferred<MockResponse>();
    const calls = installFetch((call) =>
      call.method === "POST"
        ? stuckSave.promise
        : jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    gateway.flushPendingWrites({ keepalive: true });
    expect(batchesOf(calls)).toHaveLength(1);

    // pagehide AND visibilitychange both fire on a real close — the second
    // must not abandon and re-send a request that is already unload-safe.
    gateway.flushPendingWrites({ keepalive: true });
    expect(batchesOf(calls)).toHaveLength(1);
    expect(batchesOf(calls)[0].signal?.aborted).toBe(false);
  });

  it("an over-budget unload batch drops keepalive rather than being refused outright", async () => {
    // Over the 64 KiB keepalive quota the fetch is a NETWORK ERROR, not a
    // truncation — requesting keepalive here would guarantee the loss.
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    const huge = { ...clip("a2"), alt: "x".repeat(80_000) };
    gateway.writeClips("a", [huge]);
    gateway.flushPendingWrites({ keepalive: true });

    const batches = batchesOf(calls);
    expect(batches).toHaveLength(1);
    expect(batches[0].bodyBytes).toBeGreaterThan(64 * 1024);
    expect(batches[0].keepalive).toBeFalsy(); // sent best-effort instead
    // The batch still went out INTACT — atomicity is not traded away.
    expect(clipIds(batches[0].writes?.[0].document)).toEqual(["a2"]);
    // And the risk is surfaced rather than swallowed.
    expect(gateway.lastError()).toMatch(/too large/i);
  });

  it("a body under the keepalive budget still gets keepalive", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    gateway.flushPendingWrites({ keepalive: true });

    const batches = batchesOf(calls);
    expect(batches[0].bodyBytes).toBeLessThan(56 * 1024);
    expect(batches[0].keepalive).toBe(true);
    expect(gateway.lastError()).toBeNull();
  });

  it("refresh keeps cached content readable but makes ensure refetch it", async () => {
    const secondLoad = deferred<MockResponse>();
    let gets = 0;
    const calls = installFetch((call) => {
      if (call.method !== "GET") return okResults(call.writes);
      gets += 1;
      return gets === 1
        ? jsonResponse({ document: doc("a", [clip("v1")]), revision: 1 })
        : secondLoad.promise;
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    expect(getsOf(calls)).toHaveLength(1);

    gateway.refresh();
    const refetch = gateway.ensure("a");
    // Stale content stays synchronously readable while the refetch runs.
    expect(clipIds(gateway.peek("a"))).toEqual(["v1"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getsOf(calls)).toHaveLength(2);

    secondLoad.resolve(jsonResponse({ document: doc("a", [clip("v2")]), revision: 6 }));
    await refetch;
    expect(clipIds(gateway.peek("a"))).toEqual(["v2"]);

    // Freshness restored: the next ensure serves the cache again, and the
    // next write expects the refetched revision.
    await gateway.ensure("a");
    expect(getsOf(calls)).toHaveLength(2);
    gateway.writeClips("a", [clip("v3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)[0].writes?.[0].expectedRevision).toBe(6);
  });

  it("a stale ensure waits for the in-flight batch to settle before refetching", async () => {
    const save = deferred<MockResponse>();
    let gets = 0;
    const calls = installFetch((call) => {
      if (call.method === "POST") return save.promise;
      gets += 1;
      return jsonResponse({
        document: doc("a", [clip(gets === 1 ? "v1" : "v2")]),
        revision: gets,
      });
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    gateway.writeClips("a", [clip("v1b")]);

    gateway.refresh(); // flushes: the batch goes out and stays in flight
    expect(batchesOf(calls)).toHaveLength(1);

    const refetch = gateway.ensure("a");
    await vi.advanceTimersByTimeAsync(0);
    // No GET yet — fetching before the save settles would read pre-save state.
    expect(getsOf(calls)).toHaveLength(1);

    save.resolve(jsonResponse({ results: [{ id: "a", revision: 2 }] }));
    const refetched = await refetch;
    expect(getsOf(calls)).toHaveLength(2);
    expect(clipIds(refetched)).toEqual(["v2"]);
  });

  // The OTHER way the cache gets ahead of the graph — and the one that actually
  // cost two collections. No conflict, no error, nothing rejected: the poller
  // refreshes a document, declines to apply the difference to the graph, and
  // the revision ledger moves anyway. The next projection of the stale graph
  // then passes CAS with a perfectly current revision.
  it("a refreshed-but-unabsorbed document blocks clip writes, CAS or no CAS", async () => {
    const calls = installFetch((call) =>
      call.method === "GET"
        ? jsonResponse({ document: doc(call.id, [clip("a-seed")]), revision: 1 })
        : okResults(call.writes),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    // Normal edit: goes out, carrying the revision it read.
    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);
    expect(batchesOf(calls)[0].writes?.[0].expectedRevision).toBe(1);

    // Now the poller refreshes it and declines to apply — the state that used
    // to be invisible. Without this marker the write below goes out with a
    // CURRENT revision and a STALE clip list, which is the whole bug: the
    // server accepts it and the other writer's content is gone.
    gateway.markGraphBehind("a", "not on this board");
    expect(gateway.isConflicted("a")).toBe(true);

    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // refused, no second batch
    expect(gateway.lastError()).toContain("could not merge it");

    // Reopening the view rebuilds the graph from fresh documents, which is the
    // reconciliation the block was waiting for — the same lifting point a
    // conflict uses.
    gateway.refresh();
    expect(gateway.isConflicted("a")).toBe(false);
  });

  it("markGraphBehind is inert for a document the cache has never seen", async () => {
    installFetch(() => okResults([]));
    const gateway = createGraphDocumentsGateway();
    // Nothing to protect and nothing to name in a message — marking an unknown
    // id would block a document that might legitimately arrive later.
    gateway.markGraphBehind("never-loaded", "not on this board");
    expect(gateway.isConflicted("never-loaded")).toBe(false);
  });

  it("a revision conflict reloads the conflicted document and DROPS THE WHOLE BATCH", async () => {
    let conflictOnce = true;
    const serverA = doc("a", [clip("a-server")]);
    const calls = installFetch((call) => {
      if (call.method === "GET") {
        // First GETs seed both docs at revision 1; the post-conflict reload
        // of "a" serves the newer server content at its real revision.
        return call.id === "a" && getsOf(calls, "a").length > 1
          ? jsonResponse({ document: serverA, revision: 5 })
          : jsonResponse({ document: doc(call.id, [clip(`${call.id}-seed`)]), revision: 1 });
      }
      if (conflictOnce && call.writes?.some((write) => write.document.id === "a")) {
        conflictOnce = false;
        return jsonResponse(
          { error: "conflict", conflicts: [{ id: "a", actualRevision: 5 }] },
          409,
        );
      }
      return okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    await gateway.ensure("b");

    gateway.writeClips("a", [clip("a2")]);
    gateway.writeClips("b", [clip("b2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // rejected as a whole

    // The conflicted doc reloaded: server content and revision win the
    // cache; the error names it AFTER the reload so it doesn't flash away.
    await vi.advanceTimersByTimeAsync(0);
    expect(clipIds(gateway.peek("a"))).toEqual(["a-server"]);
    expect(gateway.lastError()).toContain('"Timeline a" changed in another view');

    // The UNCONFLICTED write is dropped too, and this expectation is a
    // reversal: it used to assert that "b" re-queued and went out on its own.
    //
    // That broke the all-or-nothing guarantee this module promises, from the
    // client side, after the server had honoured it. A batch is one CHANGE —
    // a move is `[source -child, destination +child]`, a delete is
    // `[parent -child, trash +child]`. The server rejected the pair, so
    // sending the surviving half applies half a change: the source loses the
    // child and nothing gains it. An orphan, manufactured by the error path.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // no second batch at all
    expect(gateway.isConflicted("b")).toBe(true);

    // And "b" is blocked from further clip writes for the same reason "a" is:
    // the change its projection belonged to no longer exists.
    gateway.writeClips("b", [clip("b3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);

    // The next edit to "a" is BLOCKED, and this expectation is the fix.
    //
    // It used to assert the opposite — that the edit goes out against the
    // reloaded revision — which reads reasonable and is precisely the data
    // loss: clip writes are whole-collection projections of the LIVE GRAPH,
    // and the reload updated only this cache. Letting that write through
    // means replacing the other writer's content with a stale collection,
    // against a revision fresh enough that the server accepts it.
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1); // still no further batch
    expect(clipIds(gateway.peek("a"))).toEqual(["a-server"]); // cache untouched
    expect(gateway.lastError()).toContain("not being saved");
  });

  it("stops retrying a payload the server rejects on its merits, and releases the pending flag", async () => {
    // A 400 is not a bad moment, it is a bad payload: the same bytes get the
    // same answer forever. Re-queueing it span a 5s save loop indefinitely,
    // and because the id stayed dirty `hasPendingWrite` stayed true — which
    // made the preview's install guard refuse every manifest and re-poll on
    // its own timer. Two unbounded loops on an idle tab from one permanent
    // error.
    const calls = installFetch((call) => {
      if (call.method === "GET") {
        return jsonResponse({ document: doc(call.id, [clip(`${call.id}-seed`)]), revision: 1 });
      }
      return jsonResponse({ error: "Every batch write needs a valid timeline document." }, 400);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);

    // The rejection is surfaced, and says waiting will not help.
    expect(gateway.lastError()).toContain("not being saved");

    // NO retry — the whole point. Well past the retry cadence.
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS * 3);
    expect(batchesOf(calls)).toHaveLength(1);

    // The pending flag is released, so the preview's install guard stops
    // refusing manifests and its poll loop ends with it.
    expect(gateway.hasPendingWrite("a")).toBe(false);

    // And a further edit is blocked rather than re-sending the same reject,
    // exactly as a conflict is.
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);
    expect(gateway.isConflicted("a")).toBe(true);
  });

  it("still retries a 5xx, which really is transient", async () => {
    // The other half of the split: a server having a bad minute must not be
    // treated as a bad payload, or a blip would strand the user's edit.
    let failOnce = true;
    const calls = installFetch((call) => {
      if (call.method === "GET") {
        return jsonResponse({ document: doc(call.id, [clip(`${call.id}-seed`)]), revision: 1 });
      }
      if (failOnce) {
        failOnce = false;
        return jsonResponse({ error: "upstream exploded" }, 503);
      }
      return okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);

    // Re-queued and retried on the slower cadence, and it lands.
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS);
    expect(batchesOf(calls)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.isConflicted("a")).toBe(false);
  });

  it("lifts the conflict block when the graph is rebuilt via refresh", async () => {
    let conflictOnce = true;
    const calls = installFetch((call) => {
      if (call.method === "GET") {
        return jsonResponse({ document: doc(call.id, [clip(`${call.id}-server`)]), revision: 5 });
      }
      if (conflictOnce && call.writes?.some((write) => write.document.id === "a")) {
        conflictOnce = false;
        return jsonResponse({ error: "conflict", conflicts: [{ id: "a", actualRevision: 5 }] }, 409);
      }
      return okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.isConflicted("a")).toBe(true);

    // Blocked while conflicted.
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(1);

    // `refresh` is what re-enters the graph view and rebuilds the graph from
    // freshly fetched documents — the reconciliation the gate waits for.
    gateway.refresh();
    expect(gateway.isConflicted("a")).toBe(false);
    await gateway.ensure("a");
    gateway.writeClips("a", [clip("a4")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)).toHaveLength(2);
    expect(clipIds(batchesOf(calls)[1].writes?.[0].document)).toEqual(["a4"]);
  });

  it("reportIssue surfaces app-reported problems in the banner without touching gateway errors", async () => {
    installFetch(() => jsonResponse({ document: doc("a", [clip("a1")]), revision: 1 }));
    const gateway = createGraphDocumentsGateway();

    gateway.reportIssue("hydrate:a", 'Timeline "a" could not load its clips.');
    expect(gateway.lastError()).toContain("could not load its clips");

    // Clearing the app's key leaves the banner clean; clearing again is a
    // no-op.
    gateway.reportIssue("hydrate:a", null);
    expect(gateway.lastError()).toBeNull();
    gateway.reportIssue("hydrate:a", null);
    expect(gateway.lastError()).toBeNull();
  });

  it("seed makes a client-minted document writable with a compare-and-set create", async () => {
    const calls = installFetch((call) =>
      call.method === "POST" ? okResults(call.writes) : jsonResponse({}, 404),
    );
    const gateway = createGraphDocumentsGateway();

    gateway.seed(doc("fresh"));
    expect(clipIds(gateway.peek("fresh"))).toEqual([]);

    gateway.writeClips("fresh", [clip("f1")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const batch = batchesOf(calls)[0];
    expect(batch.writes?.[0].expectedRevision).toBe(0); // CAS create
    expect(clipIds(batch.writes?.[0].document)).toEqual(["f1"]);

    // Seeding never clobbers an existing cache entry.
    gateway.seed({ ...doc("fresh"), title: "Other" });
    expect(gateway.peek("fresh")?.title).toBe("Timeline fresh");
  });

  it("prime installs a server payload so ensure needs no fetch and writes carry its revision", async () => {
    const calls = installFetch((call) =>
      call.method === "POST" ? okResults(call.writes) : jsonResponse({}, 500),
    );
    const gateway = createGraphDocumentsGateway();
    gateway.bindUser("user-a");

    gateway.prime(doc("a", [clip("server-1")]), 7, "user-a");
    // Served straight from cache — no GET.
    expect(clipIds(await gateway.ensure("a"))).toEqual(["server-1"]);
    expect(getsOf(calls)).toHaveLength(0);

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(batchesOf(calls)[0].writes?.[0].expectedRevision).toBe(7);
  });

  it("holds primes that arrive before bind and replays them for the bound user only", () => {
    const gateway = createGraphDocumentsGateway();

    // Primed while UNBOUND — the focus-path primer renders before
    // GraphTimelineView (a dynamic import) calls bindUser. These must be held,
    // not dropped, or the child docs never warm the cache.
    gateway.prime(doc("a", [clip("a1")]), 3, "user-a");
    gateway.prime(doc("b", [clip("b1")]), 3, "user-b"); // a different user
    expect(gateway.peek("a")).toBeNull();
    expect(gateway.peek("b")).toBeNull();

    // Binding replays the held payloads — but only the ones for THIS user.
    gateway.bindUser("user-a");
    expect(clipIds(gateway.peek("a"))).toEqual(["a1"]);
    expect(gateway.peek("b")).toBeNull();
  });

  it("prime never applies over local edits or a regressed revision", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("a1")]), revision: 5 }),
    );
    const gateway = createGraphDocumentsGateway();
    gateway.bindUser("user-a");
    await gateway.ensure("a");

    // Older server read: the ledger (5) wins.
    gateway.prime(doc("a", [clip("older")]), 3, "user-a");
    expect(clipIds(gateway.peek("a"))).toEqual(["a1"]);

    // A dirty document is a local edit in flight to the server — a fresh
    // server read must not clobber it.
    gateway.writeClips("a", [clip("local")]);
    gateway.prime(doc("a", [clip("newer")]), 9, "user-a");
    expect(clipIds(gateway.peek("a"))).toEqual(["local"]);

    // Same-revision confirm on a clean cache: the cached content (which IS
    // that server revision — our own accepted write) stays, staleness
    // clears, and no refetch happens.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS); // flush the write → revision 6
    gateway.refresh(); // marks stale
    gateway.prime(doc("a", [clip("server-echo")]), 6, "user-a");
    expect(clipIds(await gateway.ensure("a"))).toEqual(["local"]);
    expect(getsOf(calls)).toHaveLength(1); // only the original seed GET

    // A payload served for ANYONE ELSE is refused outright.
    gateway.refresh();
    gateway.prime(doc("a", [clip("foreign")]), 20, "user-b");
    expect(clipIds(gateway.peek("a"))).toEqual(["local"]);
  });

  it("ensure waits for a declared-incoming prime instead of fetching", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("fetched")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();
    gateway.bindUser("user-a");

    gateway.expectPrimes(["a"]);
    const pending = gateway.ensure("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(getsOf(calls)).toHaveLength(0); // waiting, not fetching

    gateway.prime(doc("a", [clip("primed")]), 4, "user-a");
    expect(clipIds(await pending)).toEqual(["primed"]);
    expect(getsOf(calls)).toHaveLength(0); // the prime won — no fetch at all

    // A fresh cached id never registers an expectation or waits.
    gateway.expectPrimes(["a"]);
    expect(clipIds(await gateway.ensure("a"))).toEqual(["primed"]);
    expect(getsOf(calls)).toHaveLength(0);
  });

  it("an expired prime expectation falls back to the fetch", async () => {
    const calls = installFetch((call) =>
      call.method === "POST"
        ? okResults(call.writes)
        : jsonResponse({ document: doc("a", [clip("fetched")]), revision: 1 }),
    );
    const gateway = createGraphDocumentsGateway();

    gateway.expectPrimes(["a"], 500);
    const pending = gateway.ensure("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(getsOf(calls)).toHaveLength(0);

    // The window lapses without a prime: the ordinary fetch takes over.
    await vi.advanceTimersByTimeAsync(500);
    expect(clipIds(await pending)).toEqual(["fetched"]);
    expect(getsOf(calls)).toHaveLength(1);
  });

  it("keeps per-document errors: one document's success does not clear another's failure", async () => {
    let aFails = true;
    const calls = installFetch((call) => {
      if (call.method !== "POST") {
        return jsonResponse({ document: doc(call.id, [clip("seed")]), revision: 1 });
      }
      if (aFails && call.writes?.some((write) => write.document.id === "a")) {
        return jsonResponse({}, 500);
      }
      return okResults(call.writes);
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    await gateway.ensure("b");

    gateway.writeClips("a", [clip("x")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toContain('Saving "Timeline a" failed (500).');
    expect(calls.length).toBeGreaterThan(0);

    // "b" saving cleanly in a later batch must not hide "a"'s failure.
    gateway.writeClips("b", [clip("y")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toContain("Timeline a");

    // Only "a" itself succeeding clears it.
    aFails = false;
    gateway.writeClips("a", [clip("x2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toBeNull();
  });
});
