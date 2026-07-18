import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

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

type FetchCall = {
  method: string;
  id: string;
  body?: TimelineDocument;
  keepalive?: boolean;
};

/** Stubs global fetch; returns the recorded calls for assertions. */
function installFetch(handler: (call: FetchCall) => Promise<MockResponse> | MockResponse) {
  const calls: FetchCall[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = {
      method: init?.method ?? "GET",
      id: decodeURIComponent(String(input).split("/").pop() ?? ""),
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as { document: TimelineDocument }).document
          : undefined,
      keepalive: init?.keepalive,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  vi.stubGlobal("fetch", impl as unknown as typeof fetch);
  return calls;
}

const patchesOf = (calls: FetchCall[]) => calls.filter((call) => call.method === "PATCH");
const getsOf = (calls: FetchCall[]) => calls.filter((call) => call.method === "GET");
const clipIds = (document: TimelineDocument | null | undefined) =>
  document?.clips.map((entry) => entry.id);

describe("graph-documents-gateway", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ensure fetches once, dedupes concurrent calls, and serves the cache afterward", async () => {
    const calls = installFetch(() => jsonResponse({ document: doc("a", [clip("a1")]) }));
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

  it("coalesces rapid writes into one debounced PATCH carrying the latest clips", async () => {
    const calls = installFetch((call) =>
      call.method === "PATCH"
        ? jsonResponse({ document: call.body })
        : jsonResponse({ document: doc("a", [clip("a1")]) }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    gateway.writeClips("a", [clip("a3")]);
    expect(patchesOf(calls)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    const patches = patchesOf(calls);
    expect(patches).toHaveLength(1);
    expect(clipIds(patches[0].body)).toEqual(["a3"]);
  });

  it("serializes PATCHes per document: a write during a flight queues one trailing PATCH with the latest cache", async () => {
    const firstSave = deferred<MockResponse>();
    let patchCount = 0;
    const calls = installFetch((call) => {
      if (call.method !== "PATCH") return jsonResponse({ document: doc("a", [clip("a1")]) });
      patchCount += 1;
      return patchCount === 1 ? firstSave.promise : jsonResponse({ document: call.body });
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(patchesOf(calls)).toHaveLength(1); // in flight, unresolved

    // Two more edits land while the first PATCH is still out.
    gateway.writeClips("a", [clip("a3")]);
    gateway.writeClips("a", [clip("a4")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(patchesOf(calls)).toHaveLength(1); // queued, not raced

    firstSave.resolve(jsonResponse({ document: doc("a", [clip("a2")]) }));
    await vi.advanceTimersByTimeAsync(0);
    const patches = patchesOf(calls);
    expect(patches).toHaveLength(2);
    expect(clipIds(patches[1].body)).toEqual(["a4"]);
  });

  it("flushPendingWrites sends debounce-pending writes immediately, with keepalive", async () => {
    const calls = installFetch((call) =>
      call.method === "PATCH"
        ? jsonResponse({ document: call.body })
        : jsonResponse({ document: doc("a", [clip("a1")]) }),
    );
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");

    gateway.writeClips("a", [clip("a2")]);
    gateway.flushPendingWrites({ keepalive: true });
    const patches = patchesOf(calls);
    expect(patches).toHaveLength(1);
    expect(patches[0].keepalive).toBe(true);
    expect(clipIds(patches[0].body)).toEqual(["a2"]);

    // The debounce timer was consumed — no duplicate PATCH later.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(patchesOf(calls)).toHaveLength(1);
  });

  it("refresh keeps cached content readable but makes ensure refetch it", async () => {
    const secondLoad = deferred<MockResponse>();
    let gets = 0;
    const calls = installFetch((call) => {
      if (call.method !== "GET") return jsonResponse({ document: call.body });
      gets += 1;
      return gets === 1 ? jsonResponse({ document: doc("a", [clip("v1")]) }) : secondLoad.promise;
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

    secondLoad.resolve(jsonResponse({ document: doc("a", [clip("v2")]) }));
    await refetch;
    expect(clipIds(gateway.peek("a"))).toEqual(["v2"]);

    // Freshness restored: the next ensure serves the cache again.
    await gateway.ensure("a");
    expect(getsOf(calls)).toHaveLength(2);
  });

  it("a stale ensure waits for the in-flight save to settle before refetching", async () => {
    const save = deferred<MockResponse>();
    let gets = 0;
    const calls = installFetch((call) => {
      if (call.method === "PATCH") return save.promise;
      gets += 1;
      return jsonResponse({ document: doc("a", [clip(gets === 1 ? "v1" : "v2")]) });
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("a");
    gateway.writeClips("a", [clip("v1b")]);

    gateway.refresh(); // flushes: the PATCH goes out and stays in flight
    expect(patchesOf(calls)).toHaveLength(1);

    const refetch = gateway.ensure("a");
    await vi.advanceTimersByTimeAsync(0);
    // No GET yet — fetching before the save settles would read pre-save state.
    expect(getsOf(calls)).toHaveLength(1);

    save.resolve(jsonResponse({ document: doc("a", [clip("v1b")]) }));
    const refetched = await refetch;
    expect(getsOf(calls)).toHaveLength(2);
    expect(clipIds(refetched)).toEqual(["v2"]);
  });

  it("keeps per-document errors: one document's success does not clear another's failure", async () => {
    let badFails = true;
    const calls = installFetch((call) => {
      if (call.method !== "PATCH") return jsonResponse({ document: doc(call.id, [clip("seed")]) });
      if (call.body?.id === "bad" && badFails) return jsonResponse({}, 500);
      return jsonResponse({ document: call.body });
    });
    const gateway = createGraphDocumentsGateway();
    await gateway.ensure("bad");
    await gateway.ensure("good");

    gateway.writeClips("bad", [clip("x")]);
    gateway.writeClips("good", [clip("y")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toContain('Saving "Timeline bad" failed (500).');
    expect(calls.length).toBeGreaterThan(0);

    // "good" saving again must not hide "bad"'s standing failure.
    gateway.writeClips("good", [clip("y2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toContain("Timeline bad");

    // Only "bad" itself succeeding clears it.
    badFails = false;
    gateway.writeClips("bad", [clip("x2")]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(gateway.lastError()).toBeNull();
  });
});
