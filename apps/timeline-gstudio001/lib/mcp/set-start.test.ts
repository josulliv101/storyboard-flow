import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// `set_start` against the same in-memory Firestore double the rest of lib/mcp
// uses — the store, the graph adapter and the packer all run for real. That
// matters more here than usual: the whole point of the feature is that a
// placed start survives the graph round trip and comes back out of packing
// unchanged, and a mocked save would prove none of it.
type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    docs.set(id, opts?.merge && existing ? { ...existing, ...data } : { ...data });
  };
  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  const docRef = (id: string) => ({
    id,
    get: async () => snapshot(id),
    set: async (data: Stored, opts?: { merge?: boolean }) => applySet(id, data, opts),
    delete: async () => {
      docs.delete(id);
    },
  });
  type Tx = {
    get: (ref: { id: string }) => Promise<ReturnType<typeof snapshot>>;
    set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => void;
  };
  const db = {
    collection: () => ({
      doc: docRef,
      where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    }),
    runTransaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const staged: Array<[string, Stored, { merge?: boolean } | undefined]> = [];
      const tx: Tx = {
        get: async (ref) => snapshot(ref.id),
        set: (ref, data, opts) => {
          staged.push([ref.id, data, opts]);
        },
      };
      const result = await fn(tx);
      for (const [id, data, opts] of staged) applySet(id, data, opts);
      return result;
    },
  };
  return { docs, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return {
    Timestamp,
    FieldValue: {
      serverTimestamp: () => new Timestamp(),
      delete: () => "__DELETED__",
    },
  };
});

import { handleSetStart } from "./write-handlers";

const OWNER = "user-a";

function clip(id: string, over: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: "https://example.test/img.jpg",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    ...over,
  } as TimelineClip;
}

function collectionClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    childTimelineId: id,
    alt: `${id} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    itemCount: 1,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

function seed(id: string, clips: TimelineClip[], revision = 1) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid: OWNER, revision });
}

function storedClips(id: string): TimelineClip[] {
  return ((state.docs.get(id) as { clips?: TimelineClip[] } | undefined)?.clips ?? []);
}

const storedClip = (docId: string, clipId: string) =>
  storedClips(docId).find((c) => c.id === clipId);

beforeEach(() => {
  state.docs.clear();
});

describe("handleSetStart", () => {
  it("places a lane clip at the time it was given", async () => {
    seed("t1", [clip("shot", { duration: 30 }), clip("vo", { trackIndex: 1, duration: 2 })]);

    const result = await handleSetStart(
      { timelineId: "t1", nodeId: "vo", startSeconds: 7.5 },
      { requesterUid: OWNER },
    );

    expect(result.isError).not.toBe(true);
    expect(storedClip("t1", "vo")?.placedStart).toBe(7.5);
    // The point of the whole feature: it comes back out of packing where it
    // was put, rather than at the head of its lane's queue.
    expect(storedClip("t1", "vo")?.startTime).toBe(7.5);
    // ...and the picture did not move.
    expect(storedClip("t1", "shot")?.startTime).toBe(0);
  });

  it("REFUSES a clip on the picture, and says what to do instead", async () => {
    seed("t1", [clip("a"), clip("b")]);

    const result = await handleSetStart(
      { timelineId: "t1", nodeId: "b", startSeconds: 7.5 },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBe(true);
    const text = JSON.stringify(result);
    expect(text).toContain("set_lane");
    // Nothing was written.
    expect(storedClip("t1", "b")?.placedStart).toBeUndefined();
  });

  it("bumps to the next lane when something is already there, and reports it", async () => {
    seed("t1", [
      clip("shot", { duration: 30 }),
      clip("bed", { trackIndex: 1, duration: 10 }),
      clip("vo", { trackIndex: 1, duration: 2 }),
    ]);

    const result = await handleSetStart(
      { timelineId: "t1", nodeId: "vo", startSeconds: 5 },
      { requesterUid: OWNER },
    );

    expect(result.isError).not.toBe(true);
    expect(storedClip("t1", "vo")?.trackIndex).toBe(2);
    expect(storedClip("t1", "vo")?.startTime).toBe(5);
    expect(JSON.stringify(result)).toContain("lane 2");
    // The bed kept its place — a bump moves the clip being placed, nothing else.
    expect(storedClip("t1", "bed")?.startTime).toBe(0);
  });

  it("stays on the requested lane when there is room", async () => {
    seed("t1", [
      clip("shot", { duration: 30 }),
      clip("bed", { trackIndex: 1, duration: 4 }),
      clip("vo", { trackIndex: 1, duration: 2 }),
    ]);

    await handleSetStart(
      { timelineId: "t1", nodeId: "vo", startSeconds: 20 },
      { requesterUid: OWNER },
    );

    expect(storedClip("t1", "vo")?.trackIndex).toBe(1);
    expect(storedClip("t1", "vo")?.startTime).toBe(20);
  });

  it("re-queues on null, dropping the field rather than writing a sentinel", async () => {
    seed("t1", [
      clip("shot", { duration: 30 }),
      clip("bed", { trackIndex: 1, duration: 4 }),
      clip("vo", { trackIndex: 1, duration: 2, placedStart: 20 }),
    ]);

    await handleSetStart(
      { timelineId: "t1", nodeId: "vo", startSeconds: null },
      { requesterUid: OWNER },
    );

    expect(storedClip("t1", "vo")?.placedStart).toBeUndefined();
    // Back behind the bed on its lane: 4s + the pack gap.
    expect(storedClip("t1", "vo")?.startTime).toBeGreaterThan(4);
  });

  it("keeps the rest of the clip's detail intact", async () => {
    seed("t1", [
      clip("shot", { duration: 30 }),
      clip("vo", {
        trackIndex: 1,
        duration: 2,
        title: "Narration",
        tags: ["keeper"],
        sourceAsset: { providerId: "cloudinary", assetId: "abc" },
      }),
    ]);

    await handleSetStart(
      { timelineId: "t1", nodeId: "vo", startSeconds: 7.5 },
      { requesterUid: OWNER },
    );

    const saved = storedClip("t1", "vo");
    // The failure this guards is silent: the detail entry is what the clip is
    // rebuilt from, so a handler that does not spread it erases these on save.
    expect(saved?.title).toBe("Narration");
    expect(saved?.tags).toEqual(["keeper"]);
    // `sourceAsset` lives on media clips only, so narrow before reading it.
    if (!saved || saved.kind === "collection") throw new Error("expected a media clip");
    expect(saved.sourceAsset).toEqual({ providerId: "cloudinary", assetId: "abc" });
  });

  it("writes the parent AND its ancestors", async () => {
    // A placement can lengthen or shorten the parent, and every ancestor
    // stores a duration for it — the same write set `set_lane` computes.
    seed("root", [collectionClip("scene")]);
    seed("scene", [clip("shot", { duration: 30 }), clip("vo", { trackIndex: 1, duration: 2 })]);

    const result = await handleSetStart(
      { timelineId: "root", nodeId: "vo", startSeconds: 7.5 },
      { requesterUid: OWNER },
    );

    expect(result.isError).not.toBe(true);
    const written = JSON.stringify(result);
    expect(written).toContain("scene");
    expect(written).toContain("root");
  });

  it("rejects a start that is not a real non-negative time", async () => {
    seed("t1", [clip("shot", { duration: 30 }), clip("vo", { trackIndex: 1, duration: 2 })]);

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await handleSetStart(
        { timelineId: "t1", nodeId: "vo", startSeconds: bad },
        { requesterUid: OWNER },
      );
      expect(result.isError).toBe(true);
    }
    expect(storedClip("t1", "vo")?.placedStart).toBeUndefined();
  });

  it("reports an unknown node rather than writing anything", async () => {
    seed("t1", [clip("shot", { duration: 30 })]);

    const result = await handleSetStart(
      { timelineId: "t1", nodeId: "nope", startSeconds: 5 },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBe(true);
  });
});
