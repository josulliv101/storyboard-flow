import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { createGraphDocumentsGateway } from "./graph-documents-gateway";

const SAVE_DEBOUNCE_MS = 900;

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

  it("a revision conflict reloads the conflicted document, surfaces it, and re-queues the rest", async () => {
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

    // The unconflicted write re-queued and goes out on its own.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const second = batchesOf(calls)[1];
    expect(second.writes?.map((write) => write.document.id)).toEqual(["b"]);
    expect(second.writes?.[0].expectedRevision).toBe(1);

    // The next edit to "a" writes against the reloaded revision and clears
    // the conflict message on success.
    gateway.writeClips("a", [clip("a3")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const third = batchesOf(calls)[2];
    expect(third.writes?.[0].expectedRevision).toBe(5);
    expect(gateway.lastError()).toBeNull();
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
