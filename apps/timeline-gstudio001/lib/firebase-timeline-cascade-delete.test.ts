import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Cascade-deletion tests over the REAL store against an in-memory Firestore.
// The subject is the TRAVERSAL: `childTimelineId` values come from stored
// clips, nothing in the write path forbids a cycle or a shared child, and the
// previous recursive walk had neither a visited set nor a bound.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const reads: string[] = [];

  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
    };
  };
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          reads.push(id);
          return snapshot(id);
        },
        delete: async () => {
          docs.delete(id);
        },
      }),
    }),
  };
  return { docs, reads, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("./firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
});

import {
  deleteFirebaseTimelineDocument,
  TimelineCascadeTooLargeError,
} from "./firebase-timeline-store";
import { TimelineAccessDeniedError } from "./timeline-ownership";

function collectionClip(id: string, childTimelineId: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    childTimelineId,
    title: childTimelineId,
    alt: `${childTimelineId} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

/** Seed a document whose collection clips point at `childIds`. */
function seed(id: string, ownerUid: string | undefined, childIds: string[] = []) {
  const document: TimelineDocument = {
    id,
    title: `Doc ${id}`,
    clips: childIds.map((childId, index) => ({
      ...collectionClip(`${id}-c${index}`, childId),
      index,
    })),
  };
  state.docs.set(id, {
    id,
    title: document.title,
    document,
    clips: document.clips,
    ...(ownerUid === undefined ? {} : { ownerUid }),
  });
}

beforeEach(() => {
  state.docs.clear();
  state.reads.length = 0;
});

describe("cascade deletion", () => {
  it("deletes a document and its nested collection children", async () => {
    seed("root", "user-a", ["child-a", "child-b"]);
    seed("child-a", "user-a", ["grandchild"]);
    seed("child-b", "user-a");
    seed("grandchild", "user-a");
    seed("unrelated", "user-a");

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect([...state.docs.keys()]).toEqual(["unrelated"]);
  });

  // The regression: this recursed A -> B -> A until the stack gave out, because
  // the parent was deleted only AFTER recursing, so the cycle never broke.
  it("terminates on a cycle instead of recursing forever", async () => {
    seed("a", "user-a", ["b"]);
    seed("b", "user-a", ["a"]);

    await deleteFirebaseTimelineDocument("a", "user-a");

    expect(state.docs.size).toBe(0);
    // Each document is READ once, not once per inbound edge.
    expect(state.reads).toEqual(["a", "b"]);
  });

  it("terminates on a self-referencing document", async () => {
    seed("loop", "user-a", ["loop"]);

    await deleteFirebaseTimelineDocument("loop", "user-a");

    expect(state.docs.size).toBe(0);
    expect(state.reads).toEqual(["loop"]);
  });

  it("visits a diamond-shared child once", async () => {
    seed("root", "user-a", ["left", "right"]);
    seed("left", "user-a", ["shared"]);
    seed("right", "user-a", ["shared"]);
    seed("shared", "user-a");

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect(state.docs.size).toBe(0);
    expect(state.reads.filter((id) => id === "shared")).toHaveLength(1);
  });

  it("refuses at the root when the document belongs to someone else", async () => {
    seed("root", "user-b", ["child"]);
    seed("child", "user-b");

    await expect(deleteFirebaseTimelineDocument("root", "user-a")).rejects.toBeInstanceOf(
      TimelineAccessDeniedError,
    );
    // Nothing removed — the refusal precedes every write.
    expect(state.docs.size).toBe(2);
  });

  it("skips a child owned by someone else but still deletes the rest", async () => {
    seed("root", "user-a", ["mine", "theirs"]);
    seed("mine", "user-a");
    seed("theirs", "user-b");

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect([...state.docs.keys()]).toEqual(["theirs"]);
  });

  it("tolerates a dangling child reference", async () => {
    seed("root", "user-a", ["missing"]);

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect(state.docs.size).toBe(0);
  });

  it("deletes a root that no longer exists without error", async () => {
    await expect(deleteFirebaseTimelineDocument("gone", "user-a")).resolves.toBeUndefined();
  });

  it("refuses an oversized tree before deleting anything", async () => {
    // A chain longer than the cascade ceiling.
    const length = 600;
    for (let i = 0; i < length; i += 1) {
      seed(`n${i}`, "user-a", i + 1 < length ? [`n${i + 1}`] : []);
    }

    await expect(deleteFirebaseTimelineDocument("n0", "user-a")).rejects.toBeInstanceOf(
      TimelineCascadeTooLargeError,
    );
    expect(state.docs.size).toBe(length);
  });

  it("deletes the deepest documents before the root", async () => {
    seed("root", "user-a", ["child"]);
    seed("child", "user-a", ["grandchild"]);
    seed("grandchild", "user-a");

    const deleteOrder: string[] = [];
    const original = state.db.collection;
    state.db.collection = () => {
      const inner = original();
      return {
        doc: (id: string) => {
          const ref = inner.doc(id);
          return {
            ...ref,
            delete: async () => {
              deleteOrder.push(id);
              await ref.delete();
            },
          };
        },
      };
    };

    try {
      await deleteFirebaseTimelineDocument("root", "user-a");
    } finally {
      state.db.collection = original;
    }

    expect(deleteOrder).toEqual(["grandchild", "child", "root"]);
  });
});
