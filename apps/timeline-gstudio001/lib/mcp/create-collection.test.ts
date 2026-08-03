import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// create_collection. Only the process boundary is faked — an in-memory
// Firestore with an all-or-nothing runTransaction, same shape as
// app/api/timelines/timelines-batch.test.ts. The store, the graph adapter and
// the collections reducer are all REAL, because the thing worth proving is that
// a command round-trips document -> graph -> document without losing clips, and
// that the revision CAS still aborts a stale write.

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
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
});

import { parseNodeId } from "@storyboard/ui/dnd-collections";

import { createCollection } from "./create-collection";

const OWNER = "user-a";

function clip(id: string): TimelineClip {
  return {
    id, index: 0, kind: "image", src: "https://example.test/img.jpg", alt: id,
    aspect: 16 / 9, trackIndex: 0, startTime: 0, duration: 4,
    sourceDuration: 4, trimIn: 0, trimOut: 0,
  };
}

function seed(id: string, clips: TimelineClip[]) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid: OWNER, revision: 1 });
}

beforeEach(() => {
  state.docs.clear();
});

describe("createCollection", () => {
  it("writes BOTH the parent clip and the collection's own document", async () => {
    seed("root", [clip("a")]);

    const result = await createCollection(
      { timelineId: "root", name: "demo one" },
      OWNER,
    );
    expect(result.isError).toBeFalsy();

    // The parent gained a collection clip...
    const parent = state.docs.get("root") as { clips: TimelineClip[] };
    const added = parent.clips.find((c) => c.kind === "collection");
    expect(added).toBeDefined();
    if (!added || added.kind !== "collection") throw new Error("expected a collection clip");
    expect(added.title).toBe("demo one");

    // ...and its OWN document exists, or a drill-in would 404.
    const child = state.docs.get(added.childTimelineId) as
      | { title?: string; clips?: TimelineClip[] }
      | undefined;
    expect(child).toBeDefined();
    expect(child?.title).toBe("demo one");
    expect(child?.clips).toEqual([]);
  });

  it("reports 0 items rather than inheriting a stale summary", async () => {
    seed("root", []);
    await createCollection({ timelineId: "root", name: "demo one" }, OWNER);
    const parent = state.docs.get("root") as { clips: TimelineClip[] };
    const added = parent.clips[0];
    if (added.kind !== "collection") throw new Error("expected a collection clip");
    expect(added.itemCount).toBe(0);
  });

  it("refuses a blank name without writing anything", async () => {
    seed("root", [clip("a")]);
    const result = await createCollection({ timelineId: "root", name: "   " }, OWNER);
    expect(result.isError).toBe(true);
    expect(state.docs.size).toBe(1);
  });

  it("places it after a named sibling", async () => {
    seed("root", [clip("a"), clip("b")]);
    await createCollection({ timelineId: "root", name: "demo one", after: "a" }, OWNER);
    const parent = state.docs.get("root") as { clips: TimelineClip[] };
    expect(parent.clips.map((c) => c.id.startsWith("timeline-") ? "NEW" : c.id))
      .toEqual(["a", "NEW", "b"]);
  });
});
