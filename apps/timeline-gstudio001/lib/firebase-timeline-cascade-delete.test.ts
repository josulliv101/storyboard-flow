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
  /** Ids in commit order, per batch — the deletion ORDER assertions read this,
   *  and its shape proves the cascade travels as batches rather than as N
   *  independent writes. */
  const commits: string[][] = [];
  /** Set to make the next commit reject, standing in for a transient failure
   *  part-way through a large deletion. */
  const failNextCommit = { value: false };

  const db = {
    collection: () => ({
      doc: (id: string) => ({
        id,
        get: async () => {
          reads.push(id);
          return snapshot(id);
        },
      }),
      // The project query the inbound-reference check runs. Chainable, because
      // the real one filters on ownerUid AND projectId.
      where: function whereChain(field: string, _op: string, value: unknown) {
        const filters: [string, unknown][] = [[field, value]];
        const chain = {
          where: (nextField: string, _nextOp: string, nextValue: unknown) => {
            filters.push([nextField, nextValue]);
            return chain;
          },
          get: async () => {
            const matched = [...docs.entries()].filter(([, data]) =>
              filters.every(([f, v]) => (data as Record<string, unknown>)[f] === v),
            );
            queries.push(filters.map(([f, v]) => `${f}=${String(v)}`).join("&"));
            return {
              size: matched.length,
              docs: matched.map(([id]) => snapshot(id)),
            };
          },
        };
        return chain;
      },
    }),
    batch: () => {
      const queued: string[] = [];
      return {
        delete: (ref: { id: string }) => {
          queued.push(ref.id);
        },
        commit: async () => {
          if (failNextCommit.value) {
            failNextCommit.value = false;
            throw new Error("simulated commit failure");
          }
          commits.push([...queued]);
          // Atomic: every id in the batch lands, or none of them did.
          for (const id of queued) docs.delete(id);
        },
      };
    },
  };
  /** Project queries issued — the inbound check must cost ONE, not a scan. */
  const queries: string[] = [];
  return { docs, reads, commits, failNextCommit, queries, db };
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
  TimelineInboundReferenceError,
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


/** Seed a document that carries a `projectId`, which is what makes the
 *  inbound-reference check affordable — and therefore possible at all. */
function seedInProject(
  id: string,
  ownerUid: string,
  projectId: string,
  childIds: string[] = [],
) {
  seed(id, ownerUid, childIds);
  state.docs.set(id, { ...(state.docs.get(id) as Stored), projectId });
}

/**
 * Seed a LEGACY record: clips at the top level only, with no nested
 * `document`. `buildSavePayload` always writes all three fields today, so
 * anything current code produced stays in sync — but a record written by an
 * older path, restored from a backup, or created externally does not, and
 * `toTimelineDocument` still serves these correctly.
 */
function seedLegacyTopLevel(id: string, ownerUid: string, childIds: string[] = []) {
  const clips = childIds.map((childId, index) => ({
    ...collectionClip(`${id}-c${index}`, childId),
    index,
  }));
  state.docs.set(id, { id, title: `Doc ${id}`, clips, ownerUid });
}

/** Seed a record whose live clips resolve ONLY from the recovery snapshot. */
function seedRecoveryOnly(id: string, ownerUid: string, childIds: string[] = []) {
  const clips = childIds.map((childId, index) => ({
    ...collectionClip(`${id}-c${index}`, childId),
    index,
  }));
  state.docs.set(id, {
    id,
    title: `Doc ${id}`,
    lastNonEmptyDocument: { id, title: `Doc ${id}`, clips },
    ownerUid,
  });
}

beforeEach(() => {
  state.queries.length = 0;
  state.docs.clear();
  state.reads.length = 0;
  state.commits.length = 0;
  state.failNextCommit.value = false;
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


  // ── ONE DEFINITION OF "THIS RECORD'S CLIPS" ───────────────────────────────
  //
  // The walk used to read `data.document?.clips ?? []` — the only
  // single-source read in the file, where every other reader resolves three
  // sources. A record serving its clips from either of the other two enqueued
  // no children, so the root was deleted and everything beneath it survived:
  // unreachable, still owned, its media never eligible for reclaim, and with
  // no path left to reach it. A silent, permanent storage leak.

  it("cascades into children of a LEGACY record with no nested document", async () => {
    seedLegacyTopLevel("root", "user-a", ["child-a"]);
    seed("child-a", "user-a", ["grandchild"]);
    seed("grandchild", "user-a");
    seed("unrelated", "user-a");

    await deleteFirebaseTimelineDocument("root", "user-a");

    // Before the fix: only "root" went, leaving child-a and grandchild
    // orphaned and unreachable.
    expect([...state.docs.keys()]).toEqual(["unrelated"]);
  });

  it("cascades into children a record serves from its RECOVERY snapshot", async () => {
    seedRecoveryOnly("root", "user-a", ["child-a"]);
    seed("child-a", "user-a");
    seed("unrelated", "user-a");

    // This is what the product would show for that record, so it is what
    // deleting it has to account for.
    await deleteFirebaseTimelineDocument("root", "user-a");

    expect([...state.docs.keys()]).toEqual(["unrelated"]);
  });

  it("does NOT cascade into a stale recovery snapshot when live clips exist", async () => {
    // The asymmetry that rules out simply unioning all three sources, the way
    // the reference COUNTER deliberately does. `moved-away` was removed from
    // this collection and lives elsewhere now; the snapshot still names it.
    // Deleting the parent must not follow that stale edge and destroy it.
    state.docs.set("root", {
      id: "root",
      title: "Doc root",
      document: { id: "root", title: "Doc root", clips: [{ ...collectionClip("root-c0", "child-a"), index: 0 }] },
      clips: [{ ...collectionClip("root-c0", "child-a"), index: 0 }],
      lastNonEmptyDocument: {
        id: "root",
        title: "Doc root",
        clips: [{ ...collectionClip("root-old", "moved-away"), index: 0 }],
      },
      ownerUid: "user-a",
    });
    seed("child-a", "user-a");
    seed("moved-away", "user-a");

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect([...state.docs.keys()]).toEqual(["moved-away"]);
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

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect(state.commits.flat()).toEqual(["grandchild", "child", "root"]);
  });

  // The walk used to await one read at a time and then one delete at a time,
  // so a 500-document tree was 1000 sequential round trips and a transient
  // failure mid-loop left the project half removed with no way to tell.
  it("removes the whole cascade in a single atomic batch", async () => {
    seed("root", "user-a", ["child"]);
    seed("child", "user-a", ["grandchild"]);
    seed("grandchild", "user-a");

    await deleteFirebaseTimelineDocument("root", "user-a");

    expect(state.commits).toHaveLength(1);
    expect(state.docs.size).toBe(0);
  });

  it("leaves nothing deleted when the batch fails", async () => {
    seed("root", "user-a", ["child"]);
    seed("child", "user-a", ["grandchild"]);
    seed("grandchild", "user-a");
    state.failNextCommit.value = true;

    await expect(deleteFirebaseTimelineDocument("root", "user-a")).rejects.toThrow(
      /simulated commit failure/,
    );

    // All three still present: no partial deletion to reason about.
    expect([...state.docs.keys()].sort()).toEqual(["child", "grandchild", "root"]);
  });
});

describe("inbound references", () => {
  /**
   * The gap this closes: the cascade walks DOWN. It collected the subtree and
   * deleted it, and never asked who else pointed INTO that subtree — so a clip
   * from outside survived its target and became a dangling `childTimelineId`.
   *
   * Not hypothetical. Five of them in one real project added 33.9s of phantom
   * footage to a collection's readout, and a delete the owner was about to run
   * would have created a sixth.
   *
   * Answering it used to mean scanning the collection, hundreds of reads per
   * delete. With `projectId` on every document it is one query, which is the
   * only reason this check exists now and did not before.
   */
  it("refuses when a document outside the subtree points into it", async () => {
    seedInProject("root", "user-a", "p1", ["mid"]);
    seedInProject("mid", "user-a", "p1", ["leaf"]);
    seedInProject("leaf", "user-a", "p1");
    // The outsider — not part of the delete, but pointing at its deepest member.
    seedInProject("elsewhere", "user-a", "p1", ["leaf"]);

    await expect(deleteFirebaseTimelineDocument("root", "user-a")).rejects.toBeInstanceOf(
      TimelineInboundReferenceError,
    );
    // NOTHING deleted — the check runs before the batch, so a refusal is not a
    // partial delete.
    expect(state.commits).toEqual([]);
    expect(state.docs.has("leaf")).toBe(true);
  });

  it("names what points where, so the caller can act on it", async () => {
    seedInProject("root", "user-a", "p1", ["mid"]);
    seedInProject("mid", "user-a", "p1");
    seedInProject("elsewhere", "user-a", "p1", ["mid"]);

    const error = await deleteFirebaseTimelineDocument("root", "user-a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimelineInboundReferenceError);
    expect((error as TimelineInboundReferenceError).references).toEqual([
      { fromId: "elsewhere", toId: "mid" },
    ]);
  });

  it("ignores the ROOT's own parent, which legitimately points at it", async () => {
    // Deleting a collection always leaves its parent holding a clip for it —
    // removing that clip is the caller's job, in the same write. Treating it as
    // an inbound reference would refuse every delete there is.
    seedInProject("parent", "user-a", "p1", ["root"]);
    seedInProject("root", "user-a", "p1", ["mid"]);
    seedInProject("mid", "user-a", "p1");

    await deleteFirebaseTimelineDocument("root", "user-a");
    expect(state.docs.has("root")).toBe(false);
    expect(state.docs.has("mid")).toBe(false);
  });

  it("ignores references from documents that are themselves being deleted", async () => {
    // A diamond inside the subtree is not a dangling reference in waiting —
    // both ends go at once.
    seedInProject("root", "user-a", "p1", ["a", "b"]);
    seedInProject("a", "user-a", "p1", ["shared"]);
    seedInProject("b", "user-a", "p1", ["shared"]);
    seedInProject("shared", "user-a", "p1");

    await deleteFirebaseTimelineDocument("root", "user-a");
    expect(state.docs.has("shared")).toBe(false);
  });

  it("costs ONE query, not a scan", async () => {
    seedInProject("root", "user-a", "p1", ["mid"]);
    seedInProject("mid", "user-a", "p1");

    await deleteFirebaseTimelineDocument("root", "user-a");
    // The whole reason the check is affordable. A per-document lookup, or a
    // collection scan, is the cost this line of work exists to remove.
    expect(state.queries).toEqual(["ownerUid=user-a&projectId=p1"]);
  });

  it("skips the check for a document with no projectId rather than scanning", async () => {
    // A deliberate gap, documented at the call site: legacy records predate the
    // field, and `npm run stamp:project-ids` is the fix. Refusing to delete
    // them, or scanning per delete, are both worse.
    seed("root", "user-a", ["mid"]);
    seed("mid", "user-a");
    seed("elsewhere", "user-a", ["mid"]);

    await deleteFirebaseTimelineDocument("root", "user-a");
    expect(state.queries).toEqual([]);
    expect(state.docs.has("mid")).toBe(false);
  });
});
