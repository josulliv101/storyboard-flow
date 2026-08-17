import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Batch READ tests over the real route handler and the real serve path — only
// the process boundaries are faked (the Firestore SDK, the session cookie, the
// Cloudinary listing).
//
// The thing under test is not "many documents come back". It is that the batch
// reads each underlying document ONCE no matter how many of the requested
// closures contain it, because every id is served through one shared
// `createTimelineEntryReader`. That is the entire reason this endpoint exists
// (#437), and it is invisible in the response — only a read COUNT can see it,
// which is why the mock counts.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = {
    user: { uid: "user-a", email: null as string | null, name: null, picture: null },
  };
  /** Every document the store reads, however it read it — one Firestore
   *  document read each, whether it arrived via `doc(id).get()` or in a
   *  `getAll` batch. Batching changes the number of REQUESTS, never the number
   *  of documents, so these assertions hold across both. */
  const reads: string[] = [];

  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
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
      }),
    }),
    getAll: async (...refs: { id: string }[]) =>
      refs.map((ref) => {
        reads.push(ref.id);
        return snapshot(ref.id);
      }),
  };
  return { docs, current, db, reads };
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
    FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => "__delete__" },
  };
});
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));
vi.mock("@/lib/cloudinary-media-store", () => ({ listCloudinaryAssets: async () => [] }));

import { POST as batchGet } from "./batch-get/route";
import { GET as getTimeline } from "./[id]/route";

type BatchEntry = {
  id: string;
  document?: TimelineDocument;
  revision?: number;
  error?: string;
  status?: number;
};

const post = async (body: unknown) => {
  const response = await batchGet(
    new Request("http://localhost/api/timelines/batch-get", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as { results?: BatchEntry[]; error?: string } };
};

const byId = (results: BatchEntry[] | undefined) =>
  new Map((results ?? []).map((entry) => [entry.id, entry]));

function mediaClip(id: string, index: number): TimelineClip {
  return {
    id,
    index,
    kind: "image",
    src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    poster: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

function collectionClip(id: string, childTimelineId: string, index: number): TimelineClip {
  return {
    id,
    index,
    kind: "collection",
    title: childTimelineId,
    childTimelineId,
    itemCount: 1,
    previewItems: [],
    alt: childTimelineId,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
}

const store = (id: string, clips: TimelineClip[], ownerUid = "user-a") => {
  state.docs.set(id, { id, title: id, clips, ownerUid, revision: 3 });
};

/**
 * A project whose children SHARE descendants — which is the shape that makes
 * the shared reader worth having. `scene-a` and `scene-b` both point at
 * `shared-leaf`, so serving them individually reads it twice.
 */
const seedTree = () => {
  store("shared-leaf", [mediaClip("leaf-1", 0)]);
  store("scene-a", [collectionClip("a-c", "shared-leaf", 0)]);
  store("scene-b", [collectionClip("b-c", "shared-leaf", 0)]);
  store("project", [
    collectionClip("p-a", "scene-a", 0),
    collectionClip("p-b", "scene-b", 1),
  ]);
};

beforeEach(() => {
  state.docs.clear();
  state.reads.length = 0;
  state.current.user = { uid: "user-a", email: null, name: null, picture: null };
});

describe("batch read", () => {
  it("returns every requested document, with its revision", async () => {
    seedTree();
    const { status, body } = await post({ ids: ["project", "scene-a", "scene-b"] });
    expect(status).toBe(200);
    const results = byId(body.results);
    expect([...results.keys()].sort()).toEqual(["project", "scene-a", "scene-b"]);
    expect(results.get("project")?.document?.id).toBe("project");
    expect(results.get("project")?.revision).toBe(3);
  });

  // THE POINT OF THE ENDPOINT. Serving these ids one at a time re-walks every
  // shared descendant per request; one shared reader collapses that to one read
  // per document. Asserted as a COUNT because the responses are identical
  // either way — this is the only place the saving is observable.
  it("reads each underlying document ONCE, however many closures contain it", async () => {
    seedTree();
    await post({ ids: ["project", "scene-a", "scene-b"] });

    const counts = new Map<string, number>();
    for (const id of state.reads) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.get("shared-leaf")).toBe(1);
    expect(counts.get("scene-a")).toBe(1);
    expect(counts.get("scene-b")).toBe(1);
    expect(counts.get("project")).toBe(1);
    expect(state.reads.length).toBe(4);
  });

  // The same three ids through the per-document GET, for contrast. This is the
  // behaviour the batch replaces, and pinning it is what stops someone
  // "simplifying" the batch back into a loop of single serves.
  it("costs strictly more when the same ids are served one request at a time", async () => {
    seedTree();
    for (const id of ["project", "scene-a", "scene-b"]) {
      await getTimeline(new Request(`http://localhost/api/timelines/${id}`), {
        params: Promise.resolve({ id }),
      });
    }
    expect(state.reads.length).toBeGreaterThan(4);
    const shared = state.reads.filter((id) => id === "shared-leaf").length;
    expect(shared).toBeGreaterThan(1);
  });

  it("deduplicates repeated ids in the request", async () => {
    seedTree();
    const { body } = await post({ ids: ["scene-a", "scene-a", "scene-a"] });
    expect(body.results).toHaveLength(1);
  });

  // PER-DOCUMENT outcomes. A batch that failed whole because one id was
  // somebody else's would be strictly worse than the GETs it replaces: one bad
  // id in a hydration burst would blank the board.
  it("refuses one id without failing the rest, and does not leak existence", async () => {
    seedTree();
    store("someone-elses", [mediaClip("x", 0)], "user-b");
    const { status, body } = await post({ ids: ["scene-a", "someone-elses"] });
    expect(status).toBe(200);
    const results = byId(body.results);
    expect(results.get("scene-a")?.document?.id).toBe("scene-a");
    // A plain not-found, so timeline ids cannot be probed for existence.
    expect(results.get("someone-elses")?.status).toBe(404);
    expect(results.get("someone-elses")?.error).toBe("Timeline was not found.");
    expect(results.get("someone-elses")?.document).toBeUndefined();
  });

  it("rejects a malformed id per document, and a missing one as not found", async () => {
    seedTree();
    const { body } = await post({ ids: ["scene-a", "bad id!", "no-such-document"] });
    const results = byId(body.results);
    expect(results.get("scene-a")?.document).toBeDefined();
    expect(results.get("bad id!")?.status).toBe(400);
    expect(results.get("no-such-document")?.status).toBe(404);
  });

  it("refuses a request that is not a list of ids, or is too long", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ ids: "project" })).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, index) => `id-${index}`);
    expect((await post({ ids: tooMany })).status).toBe(400);
  });

  it("serves an empty request as an empty result rather than an error", async () => {
    const { status, body } = await post({ ids: [] });
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
  });
});
