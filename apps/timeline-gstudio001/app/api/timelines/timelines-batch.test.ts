import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { at } from "../../../lib/test-support/at";

// Batch-write tests over the REAL route handler and the REAL
// firebase-timeline-store transaction — only the process boundaries are
// faked: the Firestore SDK (in-memory, with an all-or-nothing
// runTransaction), the session cookie, and the Cloudinary listing. Covers
// the review's cross-document atomicity finding: several documents commit
// as a unit, a single revision mismatch rejects everything, and revisions
// stamp/bump through GET, PATCH, and batch alike.

type Stored = Record<string, unknown>;

const DELETE_SENTINEL = "__delete__";

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = { user: { uid: "user-a", email: null as string | null, name: null, picture: null } };

  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    const merged = opts?.merge && existing ? { ...existing, ...data } : { ...data };
    // Firestore's FieldValue.delete() REMOVES the field on a merge write. The
    // store uses it to drop `lastNonEmptyDocument` on a deliberate empty, so a
    // mock that stored the sentinel verbatim would leave the recovery snapshot
    // in place and report an empty that silently re-hydrates as fine.
    // Same sentinel as trash-empty.test.ts.
    for (const [key, value] of Object.entries(merged)) {
      if (value === DELETE_SENTINEL) delete merged[key];
    }
    docs.set(id, merged);
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
      where: (field: string, _op: string, value: unknown) => ({
        limit: () => ({
          get: async () => ({
            docs: [...docs.keys()].filter((id) => docs.get(id)?.[field] === value).map(snapshot),
          }),
        }),
      }),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => {
          ops.push(() => applySet(ref.id, data, opts));
        },
        commit: async () => {
          for (const op of ops) op();
        },
      };
    },
    // All-or-nothing like the real thing: staged sets apply only when the
    // transaction function resolves; a throw discards every staged write.
    runTransaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const staged: (() => void)[] = [];
      const tx: Tx = {
        get: async (ref) => snapshot(ref.id),
        set: (ref, data, opts) => {
          staged.push(() => applySet(ref.id, data, opts));
        },
      };
      const result = await fn(tx);
      for (const op of staged) op();
      return result;
    },
  };
  return { docs, current, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseDb: () => state.db,
}));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return {
    Timestamp,
    FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => "__delete__" },
  };
});
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async () => [],
}));

import { POST as batchWrite } from "./batch/route";
import { GET as getTimeline, PATCH as patchTimeline } from "./[id]/route";

const asUser = (uid: string) => {
  state.current.user = { uid, email: null, name: null, picture: null };
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });

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

function seedTimeline(id: string, ownerUid: string | undefined, revision?: number) {
  const document: TimelineDocument = { id, title: `Timeline ${id}`, clips: [clip(`${id}-c0`)] };
  state.docs.set(id, {
    id,
    title: document.title,
    document,
    clips: document.clips,
    isProject: true,
    ...(ownerUid === undefined ? {} : { ownerUid }),
    ...(revision === undefined ? {} : { revision }),
  });
}

function batchRequest(
  writes: {
    document: TimelineDocument;
    expectedRevision?: number;
    allowEmptying?: unknown;
  }[],
) {
  return new Request("http://test.local/api/timelines/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
}

function collectionClip(childTimelineId: string, clipId = childTimelineId): TimelineClip {
  return {
    id: clipId,
    index: 0,
    kind: "collection",
    childTimelineId,
    title: `Timeline ${childTimelineId}`,
    itemCount: 0,
    previewItems: [],
    alt: `${childTimelineId} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  } as unknown as TimelineClip;
}

function seedParentWithChild(parentId: string, childId: string, revision = 1) {
  const document: TimelineDocument = {
    id: parentId,
    title: `Timeline ${parentId}`,
    clips: [collectionClip(childId)],
  };
  state.docs.set(parentId, {
    id: parentId, title: document.title, document, clips: document.clips,
    isProject: true, ownerUid: "user-a", revision,
  });
  const child: TimelineDocument = { id: childId, title: `Timeline ${childId}`, clips: [clip(`${childId}-c0`)] };
  state.docs.set(childId, {
    id: childId, title: child.title, document: child, clips: child.clips,
    isProject: false, ownerUid: "user-a", revision: 1,
  });
}

const emptyDoc = (id: string): TimelineDocument => ({ id, title: `Timeline ${id}`, clips: [] });

function docOf(id: string, clipId: string): TimelineDocument {
  return { id, title: `Timeline ${id}`, clips: [clip(clipId)] };
}

beforeEach(() => {
  state.docs.clear();
  asUser("user-a");
});

describe("timeline batch writes", () => {
  it("writes several documents atomically and stamps bumped revisions", async () => {
    seedTimeline("doc-1", "user-a", 3);
    seedTimeline("doc-2", "user-a"); // legacy: no revision field = 0

    const response = await batchWrite(
      batchRequest([
        { document: docOf("doc-1", "new-1"), expectedRevision: 3 },
        { document: docOf("doc-2", "new-2"), expectedRevision: 0 },
      ]),
    );
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: { id: string; revision: number }[] };
    expect(results).toEqual([
      { id: "doc-1", revision: 4 },
      { id: "doc-2", revision: 1 },
    ]);

    expect(at((state.docs.get("doc-1")?.document as TimelineDocument).clips, 0).id).toBe("new-1");
    expect(at((state.docs.get("doc-2")?.document as TimelineDocument).clips, 0).id).toBe("new-2");
    expect(state.docs.get("doc-1")?.revision).toBe(4);
    expect(state.docs.get("doc-1")?.ownerUid).toBe("user-a");
    expect(state.docs.get("doc-1")?.isProject).toBe(true); // preserved, not reset
  });

  it("a single revision mismatch rejects the WHOLE batch and writes nothing", async () => {
    seedTimeline("doc-1", "user-a", 3);
    seedTimeline("doc-2", "user-a", 1);
    const before1 = state.docs.get("doc-1");
    const before2 = state.docs.get("doc-2");

    const response = await batchWrite(
      batchRequest([
        { document: docOf("doc-1", "stale"), expectedRevision: 2 }, // actual is 3
        { document: docOf("doc-2", "fine"), expectedRevision: 1 },
      ]),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      conflicts: { id: string; actualRevision: number }[];
    };
    expect(body.conflicts).toEqual([{ id: "doc-1", actualRevision: 3 }]);

    expect(state.docs.get("doc-1")).toEqual(before1);
    expect(state.docs.get("doc-2")).toEqual(before2); // the matching write rolled back too
  });

  it("creates a new document with expectation 0 and stamps the owner", async () => {
    const response = await batchWrite(
      batchRequest([{ document: docOf("doc-new", "c1"), expectedRevision: 0 }]),
    );
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: { id: string; revision: number }[] };
    expect(results).toEqual([{ id: "doc-new", revision: 1 }]);
    expect(state.docs.get("doc-new")?.ownerUid).toBe("user-a");
  });

  it("expectation-less writes keep last-write-wins semantics", async () => {
    seedTimeline("doc-1", "user-a", 3);

    const response = await batchWrite(batchRequest([{ document: docOf("doc-1", "lww") }]));
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as { results: { id: string; revision: number }[] };
    expect(results).toEqual([{ id: "doc-1", revision: 4 }]);
  });

  it("another user's document rejects the whole batch as 404 and writes nothing", async () => {
    seedTimeline("doc-a", "user-a", 1);
    seedTimeline("doc-b", "user-b", 1);
    const beforeA = state.docs.get("doc-a");
    const beforeB = state.docs.get("doc-b");

    const response = await batchWrite(
      batchRequest([
        { document: docOf("doc-a", "mine"), expectedRevision: 1 },
        { document: docOf("doc-b", "theirs"), expectedRevision: 1 },
      ]),
    );
    expect(response.status).toBe(404);
    expect(state.docs.get("doc-a")).toEqual(beforeA);
    expect(state.docs.get("doc-b")).toEqual(beforeB);
  });

  it("rejects another user's trash id before any storage access", async () => {
    asUser("user-b");
    const response = await batchWrite(
      batchRequest([{ document: { id: "trash-user-a", title: "Trash Bin", clips: [clip("x")] } }]),
    );
    expect(response.status).toBe(404);
    expect(state.docs.size).toBe(0);
  });

  it("refuses an empty document over an existing non-empty one, batch-wide", async () => {
    seedTimeline("doc-1", "user-a", 2);
    const before = state.docs.get("doc-1");

    const response = await batchWrite(
      batchRequest([
        { document: { id: "doc-1", title: "Timeline doc-1", clips: [] }, expectedRevision: 2 },
      ]),
    );
    expect(response.status).toBe(409);
    expect(state.docs.get("doc-1")).toEqual(before);
  });

  // The other half of that guard. Removing a collection's LAST clip is a legal
  // edit, and until the flag reached this route the app could not do it at all
  // — `allowEmptying` existed on the store and on the MCP path, but the batch
  // body carried only `document` and `expectedRevision`, so the UI had no way
  // to say the empty was deliberate.
  it("allowEmptying lets a deliberate removal empty a document", async () => {
    seedTimeline("doc-1", "user-a", 2);

    const response = await batchWrite(
      batchRequest([
        {
          document: { id: "doc-1", title: "Timeline doc-1", clips: [] },
          expectedRevision: 2,
          allowEmptying: true,
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(state.docs.get("doc-1")?.clips).toEqual([]);
    expect(state.docs.get("doc-1")?.revision).toBe(3);
  });

  // The empty must STICK. `toTimelineDocument` reads `lastNonEmptyDocument`
  // back whenever a stored document has no clips, so permitting the write
  // without dropping that snapshot would re-hydrate the very clip the user
  // removed and the removal would silently undo itself on the next read.
  it("a permitted empty drops the recovery snapshot, so it does not re-hydrate", async () => {
    // Establish a REAL snapshot first: it is written by every non-empty save,
    // and the seed does not carry one. Asserting it is absent without putting
    // it there is a test that passes for the wrong reason.
    seedTimeline("doc-1", "user-a", 1);
    await batchWrite(batchRequest([{ document: docOf("doc-1", "keeper"), expectedRevision: 1 }]));
    expect(state.docs.get("doc-1")?.lastNonEmptyDocument).toBeDefined();

    const response = await batchWrite(
      batchRequest([
        {
          document: { id: "doc-1", title: "Timeline doc-1", clips: [] },
          expectedRevision: 2,
          allowEmptying: true,
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(state.docs.get("doc-1")?.clips).toEqual([]);
    expect(state.docs.get("doc-1")?.lastNonEmptyDocument).toBeUndefined();
  });

  // Per-write, not per-batch. Stated as a CONTRAST, because a batch is
  // all-or-nothing: flagging neither and flagging only one both end in 409, so
  // only the flagged-both case can show the flag is what did it.
  it("allowEmptying exempts ONLY the write that carries it", async () => {
    const emptyDoc = (id: string) => ({ id, title: `Timeline ${id}`, clips: [] });

    seedTimeline("doc-1", "user-a", 1);
    seedTimeline("doc-2", "user-a", 1);
    const unflagged = await batchWrite(
      batchRequest([
        { document: emptyDoc("doc-1"), expectedRevision: 1, allowEmptying: true },
        { document: emptyDoc("doc-2"), expectedRevision: 1 },
      ]),
    );
    expect(unflagged.status).toBe(409);
    expect(state.docs.get("doc-1")?.clips).toHaveLength(1);
    expect(state.docs.get("doc-2")?.clips).toHaveLength(1);

    const bothFlagged = await batchWrite(
      batchRequest([
        { document: emptyDoc("doc-1"), expectedRevision: 1, allowEmptying: true },
        { document: emptyDoc("doc-2"), expectedRevision: 1, allowEmptying: true },
      ]),
    );
    expect(bothFlagged.status).toBe(200);
    expect(state.docs.get("doc-1")?.clips).toEqual([]);
    expect(state.docs.get("doc-2")?.clips).toEqual([]);
  });

  it("rejects a non-boolean allowEmptying as a 400", async () => {
    seedTimeline("doc-1", "user-a", 1);
    const response = await batchWrite(
      batchRequest([
        { document: docOf("doc-1", "x"), expectedRevision: 1, allowEmptying: "yes" },
      ]),
    );
    expect(response.status).toBe(400);
    expect(state.docs.get("doc-1")?.revision).toBe(1);
  });

  // ── THE ORPHAN GUARD ──────────────────────────────────────────────────────
  //
  // A collection is reachable only through a clip in some parent. Drop the last
  // one and the document survives in storage with no path to it: invisible in
  // the UI, absent from the trash, recoverable only by querying the database.

  it("REFUSES a write that removes a collection nothing else takes up", async () => {
    seedParentWithChild("parent-1", "child-1");

    const response = await batchWrite(
      batchRequest([{ document: emptyDoc("parent-1"), expectedRevision: 1, allowEmptying: true }]),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; orphans?: { id: string }[] };
    expect(body.error).toContain("Refusing to strand");
    expect(body.orphans?.map((orphan) => orphan.id)).toEqual(["child-1"]);
    // Nothing committed — the parent still points at it.
    expect((state.docs.get("parent-1")?.clips as TimelineClip[]).length).toBe(1);
  });

  it("ALLOWS a move: the destination takes it up in the same batch", async () => {
    seedParentWithChild("parent-1", "child-1");
    state.docs.set("parent-2", {
      id: "parent-2", title: "Timeline parent-2", document: emptyDoc("parent-2"),
      clips: [], isProject: true, ownerUid: "user-a", revision: 1,
    });

    const response = await batchWrite(
      batchRequest([
        { document: emptyDoc("parent-1"), expectedRevision: 1, allowEmptying: true },
        {
          document: { id: "parent-2", title: "Timeline parent-2", clips: [collectionClip("child-1")] },
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(200);
    expect(at((state.docs.get("parent-2")?.clips as TimelineClip[]), 0).id).toBe("child-1");
  });

  it("ALLOWS a delete: the trash is the document taking it up", async () => {
    seedParentWithChild("parent-1", "child-1");
    state.docs.set("trash-user-a", {
      id: "trash-user-a", title: "Trash Bin", document: emptyDoc("trash-user-a"),
      clips: [], isProject: false, ownerUid: "user-a", revision: 1,
    });

    const response = await batchWrite(
      batchRequest([
        { document: emptyDoc("parent-1"), expectedRevision: 1, allowEmptying: true },
        {
          document: { id: "trash-user-a", title: "Trash Bin", clips: [collectionClip("child-1")] },
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(200);
  });

  it("ALLOWS dropping a DUPLICATE REFERENCE — it never owned the child", async () => {
    // A second card for the same timeline is minted with its own clip id. The
    // owning placement is elsewhere and untouched, so removing this strands
    // nothing; counting it would refuse a legitimate edit.
    const parent: TimelineDocument = {
      id: "parent-1",
      title: "Timeline parent-1",
      clips: [collectionClip("child-1", "clip-duplicate-ref")],
    };
    state.docs.set("parent-1", {
      id: "parent-1", title: parent.title, document: parent, clips: parent.clips,
      isProject: true, ownerUid: "user-a", revision: 1,
    });
    const child: TimelineDocument = { id: "child-1", title: "Timeline child-1", clips: [clip("c0")] };
    state.docs.set("child-1", {
      id: "child-1", title: child.title, document: child, clips: child.clips,
      isProject: false, ownerUid: "user-a", revision: 1,
    });

    const response = await batchWrite(
      batchRequest([{ document: emptyDoc("parent-1"), expectedRevision: 1, allowEmptying: true }]),
    );

    expect(response.status).toBe(200);
  });

  it("ALLOWS tidying a DANGLING reference to a child that does not exist", async () => {
    const parent: TimelineDocument = {
      id: "parent-1", title: "Timeline parent-1", clips: [collectionClip("ghost-child")],
    };
    state.docs.set("parent-1", {
      id: "parent-1", title: parent.title, document: parent, clips: parent.clips,
      isProject: true, ownerUid: "user-a", revision: 1,
    });

    const response = await batchWrite(
      batchRequest([{ document: emptyDoc("parent-1"), expectedRevision: 1, allowEmptying: true }]),
    );

    // A repair, not a loss — there was never a document to strand.
    expect(response.status).toBe(200);
  });

  // ── THE OTHER HALF OF THE INVARIANT: NO CHILD GETS TWO OWNERS ─────────────
  //
  // "A collection child has exactly one owning placement" was enforced in ONE
  // direction only — the orphan guard above refuses a write that drops a
  // child's LAST owner, and nothing refused a write that gave it a SECOND.
  // `claimedChildren` is a Set, so two documents in one batch claiming the same
  // child collapsed into one entry and committed silently.
  //
  // That is #304's failure mode at the write boundary: whatever minted the
  // second owning placement, the store took it without a word, which is why the
  // corruption was silent and only visible later as `buildGraph` failing with
  // `{reason:"duplicate-id"}` — by which point every write to that subtree was
  // blocked.
  //
  // BOTH DOCUMENTS KEEP A MEDIA CLIP in these, for the same reason the PATCH
  // tests below do: an empty document would trip "Refusing to save an empty
  // timeline" first and the test would go green on the wrong refusal.
  function seedOwner(parentId: string, childId: string | null, revision = 1) {
    const clips = childId === null ? [clip("keeper")] : [collectionClip(childId), clip("keeper")];
    const document: TimelineDocument = { id: parentId, title: `Timeline ${parentId}`, clips };
    state.docs.set(parentId, {
      id: parentId, title: document.title, document, clips,
      isProject: true, ownerUid: "user-a", revision,
    });
  }

  const docWith = (id: string, clips: TimelineClip[]): TimelineDocument => ({
    id, title: `Timeline ${id}`, clips,
  });

  it("REFUSES a batch in which two documents both OWN the same child", async () => {
    seedOwner("parent-a", "child-1");
    seedOwner("parent-b", null);
    state.docs.set("child-1", {
      id: "child-1", title: "Timeline child-1",
      document: docWith("child-1", [clip("c0")]), clips: [clip("c0")],
      isProject: false, ownerUid: "user-a", revision: 1,
    });

    // The move that failed to detach: parent-a still lists child-1 and
    // parent-b has gained it.
    const response = await batchWrite(
      batchRequest([
        {
          document: docWith("parent-a", [collectionClip("child-1"), clip("keeper")]),
          expectedRevision: 1,
        },
        {
          document: docWith("parent-b", [collectionClip("child-1"), clip("keeper")]),
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: string;
      duplicates?: { childId: string; timelineIds: string[] }[];
    };
    expect(body.error).toContain("child-1");
    expect(body.duplicates).toEqual([
      { childId: "child-1", timelineIds: ["parent-a", "parent-b"] },
    ]);
    // NOTHING committed — the whole batch is refused, so parent-b did not gain
    // the child either.
    expect(state.docs.get("parent-b")?.revision).toBe(1);
    expect((state.docs.get("parent-b")?.clips as TimelineClip[]).length).toBe(1);
  });

  it("ALLOWS the same move when it DOES detach — one owner throughout", async () => {
    seedOwner("parent-a", "child-1");
    seedOwner("parent-b", null);

    const response = await batchWrite(
      batchRequest([
        { document: docWith("parent-a", [clip("keeper")]), expectedRevision: 1 },
        {
          document: docWith("parent-b", [collectionClip("child-1"), clip("keeper")]),
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(200);
  });

  // The asymmetry the whole guard rests on: multi-parent IS legal in this
  // model, expressed as a duplicate REFERENCE card whose clip id differs from
  // its childTimelineId. Counting those as owners would refuse the legitimate
  // edit this test makes.
  it("ALLOWS a second document holding a duplicate REFERENCE to the same child", async () => {
    seedOwner("parent-a", "child-1");
    seedOwner("parent-b", null);

    const response = await batchWrite(
      batchRequest([
        {
          document: docWith("parent-a", [collectionClip("child-1"), clip("keeper")]),
          expectedRevision: 1,
        },
        {
          document: docWith("parent-b", [
            // clip id ≠ childTimelineId → a reference, owning nothing.
            collectionClip("child-1", "ref-clip-1"),
            clip("keeper"),
          ]),
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(200);
  });

  it("REFUSES one document that owns the same child TWICE", async () => {
    seedOwner("parent-a", "child-1");

    const response = await batchWrite(
      batchRequest([
        {
          document: docWith("parent-a", [
            collectionClip("child-1"),
            collectionClip("child-1"),
            clip("keeper"),
          ]),
          expectedRevision: 1,
        },
      ]),
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      duplicates?: { childId: string; timelineIds: string[] }[];
    };
    expect(body.duplicates).toEqual([
      { childId: "child-1", timelineIds: ["parent-a", "parent-a"] },
    ]);
  });

  // ── THE SAME GUARD ON THE SINGLE-DOCUMENT PATH ────────────────────────────
  //
  // PATCH /api/timelines/[id] goes through saveFirebaseTimelineEntry, NOT the
  // atomic batch write, and so had no orphan guard at all: the batch endpoint
  // refused a write that dropped a collection's last parent, and this route
  // took the same write and committed it. Nothing in the app sends PATCH
  // today, but an open endpoint that can silently strand a document is the
  // hole whether or not the app uses it.
  //
  // THE PARENT KEEPS A MEDIA CLIP in these. Emptying it would trip "Refusing
  // to save an empty timeline" first — PATCH passes no allowEmptying — and the
  // test would go green on the wrong 409 without the guard existing at all.
  // Leaving one clip behind means only the orphan guard can reject this.
  function seedParentWithChildAndMedia(parentId: string, childId: string) {
    const parent: TimelineDocument = {
      id: parentId,
      title: `Timeline ${parentId}`,
      clips: [collectionClip(childId), clip("keeper")],
    };
    state.docs.set(parentId, {
      id: parentId, title: parent.title, document: parent, clips: parent.clips,
      isProject: true, ownerUid: "user-a", revision: 1,
    });
  }

  const patchWith = (id: string, document: TimelineDocument) =>
    patchTimeline(
      new Request(`http://test.local/api/timelines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document }),
      }),
      params(id),
    );

  it("PATCH REFUSES a document that owns the same child twice", async () => {
    seedParentWithChildAndMedia("parent-1", "child-1");

    const response = await patchWith("parent-1", {
      id: "parent-1",
      title: "Timeline parent-1",
      clips: [collectionClip("child-1"), collectionClip("child-1"), clip("keeper")],
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      duplicates?: { childId: string; timelineIds: string[] }[];
    };
    expect(body.duplicates).toEqual([
      { childId: "child-1", timelineIds: ["parent-1", "parent-1"] },
    ]);
    expect(state.docs.get("parent-1")?.revision).toBe(1);
  });

  it("PATCH ALLOWS a document holding one owner and one REFERENCE to the same child", async () => {
    seedParentWithChildAndMedia("parent-1", "child-1");

    const response = await patchWith("parent-1", {
      id: "parent-1",
      title: "Timeline parent-1",
      clips: [collectionClip("child-1"), collectionClip("child-1", "ref-1"), clip("keeper")],
    });

    expect(response.status).toBe(200);
  });

  it("PATCH REFUSES a write that removes a collection nothing else takes up", async () => {
    seedParentWithChildAndMedia("parent-1", "child-1");
    state.docs.set("child-1", {
      id: "child-1", title: "Timeline child-1", document: { id: "child-1", title: "Timeline child-1", clips: [clip("c0")] },
      clips: [clip("c0")], isProject: false, ownerUid: "user-a", revision: 1,
    });

    const response = await patchWith("parent-1", {
      id: "parent-1", title: "Timeline parent-1", clips: [clip("keeper")],
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; orphans?: { id: string }[] };
    expect(body.error).toContain("Refusing to strand");
    expect(body.orphans?.map((orphan) => orphan.id)).toEqual(["child-1"]);
    // Nothing committed: the parent still points at it, at its original revision.
    expect((state.docs.get("parent-1")?.clips as TimelineClip[]).length).toBe(2);
    expect(state.docs.get("parent-1")?.revision).toBe(1);
  });

  it("PATCH ALLOWS a write that keeps the collection", async () => {
    seedParentWithChildAndMedia("parent-1", "child-1");
    state.docs.set("child-1", {
      id: "child-1", title: "Timeline child-1", document: { id: "child-1", title: "Timeline child-1", clips: [clip("c0")] },
      clips: [clip("c0")], isProject: false, ownerUid: "user-a", revision: 1,
    });

    const response = await patchWith("parent-1", {
      id: "parent-1", title: "Renamed", clips: [collectionClip("child-1"), clip("keeper")],
    });

    expect(response.status).toBe(200);
    expect(state.docs.get("parent-1")?.revision).toBe(2);
  });

  it("PATCH ALLOWS tidying a DANGLING reference to a child that does not exist", async () => {
    seedParentWithChildAndMedia("parent-1", "ghost-child");

    const response = await patchWith("parent-1", {
      id: "parent-1", title: "Timeline parent-1", clips: [clip("keeper")],
    });

    // A repair, not a loss — there was never a document to strand.
    expect(response.status).toBe(200);
    expect(state.docs.get("parent-1")?.revision).toBe(2);
  });

  it("rejects a batch that repeats a timeline id", async () => {
    seedTimeline("doc-1", "user-a", 1);
    const response = await batchWrite(
      batchRequest([
        { document: docOf("doc-1", "first"), expectedRevision: 1 },
        { document: docOf("doc-1", "second"), expectedRevision: 1 },
      ]),
    );
    expect(response.status).toBe(409);
  });

  it("GET serves the revision the next expecting write must carry", async () => {
    seedTimeline("doc-1", "user-a", 3);
    const response = await getTimeline(new Request("http://test.local"), params("doc-1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: number };
    expect(body.revision).toBe(3);
  });

  it("the single-document PATCH path stamps revisions too", async () => {
    seedTimeline("doc-1", "user-a", 3);
    const response = await patchTimeline(
      new Request("http://test.local/api/timelines/doc-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: docOf("doc-1", "patched") }),
      }),
      params("doc-1"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: number };
    expect(body.revision).toBe(4);
    expect(state.docs.get("doc-1")?.revision).toBe(4);
  });
});
