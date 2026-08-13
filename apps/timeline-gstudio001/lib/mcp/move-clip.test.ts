import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// `move_clip` against the same in-memory Firestore double the rest of lib/mcp
// uses — the store, the graph adapter and the reducer all run for real, which
// matters here because the bug was IN the store's guard and a mocked save
// would have proved nothing.
//
// Issue #305 was filed against `remove_clip`, which had already been fixed
// (2026-08-04) three days before the issue was opened. The symptom the report
// describes — "cannot empty a one-clip collection" — was real, but it belonged
// to `move_clip`, which never passed `allowEmptying` and so could not take the
// last clip OUT of a collection. That also explains the workaround in the
// report ("attach the replacement first"): adding a clip keeps the source
// non-empty, which is only a workaround for a MOVE.
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
      // Emptying a collection deletes the `lastNonEmptyDocument` recovery
      // snapshot — without that the next read re-hydrates the removed clips and
      // the empty never sticks.
      delete: () => "__DELETED__",
    },
  };
});

import { saveFirebaseTimelineDocumentsAtomic } from "@/lib/firebase-timeline-store";

import { handleMoveClip } from "./write-handlers";
const OWNER = "user-a";
const TRASH = `trash-${OWNER}`;

function clip(id: string): TimelineClip {
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
  };
}

function collectionClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    // A collection clip's stored id equals its childTimelineId — the shape the
    // whole app mints, and the one that used to break the graph build.
    childTimelineId: id,
    alt: `${id} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    itemCount: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

function seed(id: string, clips: TimelineClip[], ownerUid = OWNER, revision = 1) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid, revision });
  return document;
}

function storedClipIds(id: string): string[] {
  const data = state.docs.get(id) as { clips?: TimelineClip[] } | undefined;
  return (data?.clips ?? []).map((c) => c.id);
}

beforeEach(() => {
  state.docs.clear();
});

describe("handleMoveClip — emptying the source", () => {



  it("moves the LAST clip out of a collection", async () => {
    seed("root", [collectionClip("src"), collectionClip("dst")]);
    seed("src", [clip("only")]);
    seed("dst", [clip("other")]);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "only", into: "dst", position: "end" },
      { requesterUid: OWNER },
    );

    // Before the fix this did not merely refuse — the store threw and
    // apply-command rethrew, so the call failed with a raw exception.
    expect(result.isError).toBeFalsy();
    expect(storedClipIds("src")).toEqual([]);
    expect(storedClipIds("dst")).toEqual(["other", "only"]);
  });

  it("still fills the destination when the source empties", async () => {
    // The exemption is scoped per document: the source is allowed to empty,
    // and the destination — which is gaining a clip — is untouched by it.
    seed("root", [collectionClip("src"), collectionClip("dst")]);
    seed("src", [clip("only")]);
    seed("dst", []);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "only", into: "dst", position: "end" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("src")).toEqual([]);
    expect(storedClipIds("dst")).toEqual(["only"]);
  });

  it("reorders within a collection without emptying anything", async () => {
    // The ordinary case, pinned so the exemption cannot be blamed for it.
    seed("root", [collectionClip("lane")]);
    seed("lane", [clip("a"), clip("b")]);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "b", position: "start" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("lane")).toEqual(["b", "a"]);
  });
});

describe("handleMoveClip — re-parenting a collection (#304)", () => {
  // #304 reports a move leaving a node under BOTH parents, silently. These pin
  // the shapes it describes; all of them detach correctly, so whatever
  // produced that state is not reached by a plain move on a clean closure.

  it("detaches a collection from its old parent", async () => {
    seed("root", [collectionClip("A"), collectionClip("B")]);
    seed("A", [collectionClip("C")]);
    seed("B", []);
    seed("C", [clip("leaf")]);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "C", into: "B", position: "end" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("A")).toEqual([]);
    expect(storedClipIds("B")).toEqual(["C"]);
  });

  it("detaches when the collection moves UP to the root", async () => {
    seed("root", [collectionClip("A")]);
    seed("A", [collectionClip("C")]);
    seed("C", [clip("leaf")]);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "C", into: "root", position: "end" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("root")).toEqual(["A", "C"]);
    expect(storedClipIds("A")).toEqual([]);
  });

  it("leaves a DUPLICATE REFERENCE elsewhere in place — and that looks like #304", async () => {
    // The one shape that reproduces the reported SYMPTOM. A duplicate
    // reference card carries its own clip id; the owning placement is the one
    // with `id === childTimelineId`. Moving the owning placement is not
    // supposed to disturb the other card, so afterwards the collection is
    // legitimately listed in two places — indistinguishable, on a re-read,
    // from a move that failed to detach.
    //
    // It is NOT the duplicate-ID corruption #304 also describes: these two
    // clips have different ids, so `buildGraph` is happy. That state needs two
    // OWNING placements, which a move does not mint.
    const duplicateReference = { ...collectionClip("C"), id: "ref-to-C" } as TimelineClip;
    seed("root", [collectionClip("A"), collectionClip("B"), duplicateReference]);
    seed("A", [collectionClip("C")]);
    seed("B", []);
    seed("C", [clip("leaf")]);

    const result = await handleMoveClip(
      { timelineId: "root", nodeId: "C", into: "B", position: "end" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("A")).toEqual([]);
    expect(storedClipIds("B")).toEqual(["C"]);
    // Still referenced from the root, by its own clip id.
    expect(storedClipIds("root")).toEqual(["A", "B", "ref-to-C"]);
  });
});
