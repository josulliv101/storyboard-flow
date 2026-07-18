import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

// Batch-write tests over the REAL route handler and the REAL
// firebase-timeline-store transaction — only the process boundaries are
// faked: the Firestore SDK (in-memory, with an all-or-nothing
// runTransaction), the session cookie, and the Cloudinary listing. Covers
// the review's cross-document atomicity finding: several documents commit
// as a unit, a single revision mismatch rejects everything, and revisions
// stamp/bump through GET, PATCH, and batch alike.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = { user: { uid: "user-a", email: null as string | null, name: null, picture: null } };

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
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
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

function batchRequest(writes: { document: TimelineDocument; expectedRevision?: number }[]) {
  return new Request("http://test.local/api/timelines/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
}

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

    expect((state.docs.get("doc-1")?.document as TimelineDocument).clips[0].id).toBe("new-1");
    expect((state.docs.get("doc-2")?.document as TimelineDocument).clips[0].id).toBe("new-2");
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
