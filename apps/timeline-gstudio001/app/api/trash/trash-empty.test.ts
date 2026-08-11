import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Bin-removal tests — DELETE (empty everything) and POST (discard specific
// entries) — over the REAL handlers and the REAL
// firebase-timeline-store save path — only the process boundaries are faked
// (the Firestore SDK, the session cookie, Cloudinary). The endpoint could
// never work before: the save path refuses an empty write over a non-empty
// document, and — had it not thrown — the READ path re-hydrates
// `lastNonEmptyDocument` whenever the stored clips are empty, so the bin
// would have come straight back. Both are pinned here.
//
// Emptying the bin now MARKS the uploaded files nothing points at (PL12-003).
// The Cloudinary double still proves a negative and it is the important one:
// emptying deletes no file THEN — a mark is a tombstone, and only the reclaim
// sweep, 30 days and one re-check later, may act on it.

type Stored = Record<string, unknown>;

const DELETE_SENTINEL = "__delete__";

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const tombstones = new Map<string, Stored>();
  const current = {
    user: { uid: "user-a", email: null as string | null, name: null, picture: null },
  };
  const cloudinaryDeletes: { publicId: string; resourceType: string }[] = [];

  const applySet = (store: Map<string, Stored>, id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = store.get(id);
    const merged = opts?.merge && existing ? { ...existing, ...data } : { ...data };
    // Firestore's FieldValue.delete() removes the field on a merge write;
    // the in-memory double honours it so the read-back path is exercised
    // exactly as it runs in production.
    for (const [key, value] of Object.entries(merged)) {
      if (value === "__delete__") delete merged[key];
    }
    store.set(id, merged);
  };
  const snapshot = (store: Map<string, Stored>, id: string) => {
    const data = store.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  const docRef = (store: Map<string, Stored>) => (id: string) => ({
    id,
    get: async () => snapshot(store, id),
    set: async (data: Stored, opts?: { merge?: boolean }) => applySet(store, id, data, opts),
    delete: async () => {
      store.delete(id);
    },
    __store: store,
  });

  /**
   * Enough of a query to serve the reference scan: one equality filter, an
   * order by document id, an optional cursor and a limit. Nothing else in
   * these tests queries, so the double stays exactly this literal.
   */
  const query = (store: Map<string, Stored>, filter: { field: string; value: unknown } | null) => {
    const build = (after: string | null, limit: number | null) => ({
      where: (field: string, _op: string, value: unknown) =>
        query(store, { field, value }).__build(after, limit),
      orderBy: () => build(after, limit),
      // The real call hands back a QueryDocumentSnapshot (see
      // collectOwnedTimelineClips); only its id matters here.
      startAfter: (cursor: { id: string }) => build(cursor.id, limit),
      limit: (next: number) => build(after, next),
      get: async () => {
        const rows = [...store.entries()]
          .filter(([, data]) => filter === null || data[filter.field] === filter.value)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .filter(([id]) => after === null || id > after);
        const page = limit === null ? rows : rows.slice(0, limit);
        return { docs: page.map(([id]) => snapshot(store, id)) };
      },
      __build: build,
    });
    return build(null, null);
  };

  const collectionFor = (name: string) => {
    const store = name === "gstudioAssetTombstones" ? tombstones : docs;
    return { doc: docRef(store), ...query(store, null) };
  };
  const db = {
    collection: collectionFor,
    batch: () => {
      const writes: (() => void)[] = [];
      return {
        set: (ref: { id: string; __store: Map<string, Stored> }, data: Stored) => {
          writes.push(() => ref.__store.set(ref.id, { ...data }));
        },
        delete: (ref: { id: string; __store: Map<string, Stored> }) => {
          writes.push(() => ref.__store.delete(ref.id));
        },
        commit: async () => {
          for (const write of writes) write();
        },
      };
    },
    // Refs here carry their own `__store`, so the transaction resolves the
    // collection from the ref rather than closing over one. Writes STAGE and
    // apply on commit, like the real thing — a double that applied them
    // eagerly would hide a throw-after-write.
    runTransaction: async <T>(
      fn: (tx: {
        get: (ref: { id: string; __store: Map<string, Stored> }) => Promise<
          ReturnType<typeof snapshot>
        >;
        set: (
          ref: { id: string; __store: Map<string, Stored> },
          data: Stored,
          opts?: { merge?: boolean },
        ) => void;
      }) => Promise<T>,
    ): Promise<T> => {
      const staged: Array<
        [Map<string, Stored>, string, Stored, { merge?: boolean } | undefined]
      > = [];
      const result = await fn({
        get: async (ref) => snapshot(ref.__store, ref.id),
        set: (ref, data, opts) => {
          staged.push([ref.__store, ref.id, data, opts]);
        },
      });
      for (const [store, id, data, opts] of staged) applySet(store, id, data, opts);
      return result;
    },
  };
  return { docs, tombstones, current, db, cloudinaryDeletes };
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
    FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => DELETE_SENTINEL },
  };
});
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async () => [],
  cloudinaryUserPrefix: (uid: string) => `gstudio/${uid}/`,
  deleteCloudinaryAsset: async (publicId: string, resourceType: string) => {
    state.cloudinaryDeletes.push({ publicId, resourceType });
  },
}));

import { DELETE as emptyTrash, POST as discardTrash } from "./route";
import { GET as getTimeline } from "../timelines/[id]/route";

const TRASH_ID = "trash-user-a";

function clip(
  id: string,
  src: string,
  kind: "image" | "video" = "image",
  sourceAsset?: { providerId: string; assetId: string },
): TimelineClip {
  return {
    id,
    index: 0,
    kind,
    src,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    ...(sourceAsset === undefined ? {} : { sourceAsset }),
  } as TimelineClip;
}

/** The provenance a clip minted from the asset seam carries — the only thing
 *  that makes an asset nameable, and so deletable. */
const asset = (assetId: string) => ({ providerId: "cloudinary", assetId });

const markedIds = () =>
  [...state.tombstones.values()].map((row) => row.assetId as string).sort();

function seedTrash(clips: TimelineClip[], revision = 3) {
  const document: TimelineDocument = { id: TRASH_ID, title: "Trash Bin", clips };
  state.docs.set(TRASH_ID, {
    id: TRASH_ID,
    title: document.title,
    document,
    clips,
    // Written by every non-empty save — the recovery snapshot that used to
    // make an emptied bin refill itself on the next read.
    lastNonEmptyDocument: document,
    ownerUid: "user-a",
    revision,
  });
}

/** A LIVE (non-trash) document that still points at `assetIds`. */
function seedLiveTimeline(id: string, assetIds: string[], ownerUid = "user-a") {
  const clips = assetIds.map((assetId, index) =>
    clip(`${id}-c${index}`, `https://example.test/${assetId}`, "image", asset(assetId)),
  );
  state.docs.set(id, {
    id,
    title: id,
    document: { id, title: id, clips },
    clips,
    ownerUid,
    revision: 1,
  });
}

const readBack = async (): Promise<TimelineDocument> => {
  const response = await getTimeline(new Request(`http://test.local/api/timelines/${TRASH_ID}`), {
    params: Promise.resolve({ id: TRASH_ID }),
  });
  const body = (await response.json()) as { document: TimelineDocument };
  return body.document;
};

beforeEach(() => {
  state.docs.clear();
  state.tombstones.clear();
  state.cloudinaryDeletes.length = 0;
  state.current.user = { uid: "user-a", email: null, name: null, picture: null };
});

describe("DELETE /api/trash", () => {
  it("empties the bin", async () => {
    seedTrash([
      clip("c1", "https://example.test/a.png"),
      clip("c2", "https://example.test/b.png"),
    ]);

    const response = await emptyTrash();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, cleared: 2, marked: 0 });

    // Stored: no clips, no recovery snapshot, revision bumped.
    const stored = state.docs.get(TRASH_ID)!;
    expect((stored.document as TimelineDocument).clips).toEqual([]);
    expect(stored.clips).toEqual([]);
    expect(stored.lastNonEmptyDocument).toBeUndefined();
    expect(stored.revision).toBe(4);
    // Ownership is preserved — an empty is still an ordinary owned write.
    expect(stored.ownerUid).toBe("user-a");
  });

  it("stays empty on the next read — no refill from the recovery snapshot", async () => {
    seedTrash([clip("c1", "https://example.test/a.png")]);
    expect((await emptyTrash()).status).toBe(200);

    // Through the real GET route: `toTimelineDocument` falls back to
    // `lastNonEmptyDocument` whenever the stored clips are empty, so an empty
    // that leaves the snapshot behind reads back FULL — the bin would refill
    // itself and the button would look broken even with the write succeeding.
    expect((await readBack()).clips).toEqual([]);
  });

  it("marks only what nothing else points at, and deletes no file yet", async () => {
    // The exact shape that made the old delete-on-empty version unsafe: one
    // upload backing a clip in the bin AND a clip on a board. Deleting the
    // file behind the trashed copy would have pulled it out from under the
    // live one.
    seedTrash([
      clip("c1", "https://example.test/orphan.png", "image", asset("gstudio/user-a/orphan.png")),
      clip("c2", "https://example.test/shared.png", "image", asset("gstudio/user-a/shared.png")),
      clip("c3", "https://example.test/movie.mp4", "video", asset("gstudio/user-a/movie.mp4")),
      // No provenance: unnameable, so never deletable. Leaks, never loses.
      clip("c4", "https://example.test/legacy.png"),
    ]);
    seedLiveTimeline("project-live", ["gstudio/user-a/shared.png"]);

    const response = await emptyTrash();
    expect(await response.json()).toEqual({ success: true, cleared: 4, marked: 2 });
    expect(markedIds()).toEqual(["gstudio/user-a/movie.mp4", "gstudio/user-a/orphan.png"]);
    // Marking is not deleting: nothing reaches the vendor until the sweep has
    // waited out the grace period and re-checked.
    expect(state.cloudinaryDeletes).toEqual([]);
    // The bin still emptied — that is the whole job.
    expect(state.docs.get(TRASH_ID)?.clips).toEqual([]);
  });

  it("records the kind, because the sweep will have no clip left to ask", async () => {
    seedTrash([
      clip("c1", "https://example.test/movie.mp4", "video", asset("gstudio/user-a/movie.mp4")),
    ]);

    await emptyTrash();
    const [tombstone] = [...state.tombstones.values()];
    expect(tombstone).toMatchObject({
      providerId: "cloudinary",
      assetId: "gstudio/user-a/movie.mp4",
      kind: "video",
      ownerUid: "user-a",
    });
    // 30 days out, not now.
    const grace = (tombstone.deleteAfterMs as number) - (tombstone.markedAtMs as number);
    expect(grace).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("counts a reference held only by the recovery snapshot", async () => {
    // `lastNonEmptyDocument` is one ordinary read away from being the live
    // document again (see toTimelineDocument), so a clip reachable only
    // through it is still a reference. Over-count, never under-count.
    const held = "gstudio/user-a/held.png";
    seedTrash([clip("c1", "https://example.test/held.png", "image", asset(held))]);
    state.docs.set("project-emptied", {
      id: "project-emptied",
      title: "Emptied",
      document: { id: "project-emptied", title: "Emptied", clips: [] },
      clips: [],
      lastNonEmptyDocument: {
        id: "project-emptied",
        title: "Emptied",
        clips: [clip("live", "https://example.test/held.png", "image", asset(held))],
      },
      ownerUid: "user-a",
      revision: 2,
    });

    expect(await (await emptyTrash()).json()).toEqual({ success: true, cleared: 1, marked: 0 });
    expect(markedIds()).toEqual([]);
  });

  it("ignores another user's reference to the same asset id", async () => {
    // Assets are per-user in both providers, so this cannot happen today — but
    // the scan is what enforces it, and a scan that read everyone's documents
    // would be the round-12 bug again in a new place.
    const orphan = "gstudio/user-a/orphan.png";
    seedTrash([clip("c1", "https://example.test/orphan.png", "image", asset(orphan))]);
    seedLiveTimeline("project-other", [orphan], "user-b");

    expect(await (await emptyTrash()).json()).toEqual({ success: true, cleared: 1, marked: 1 });
    expect(markedIds()).toEqual([orphan]);
  });

  it("is a no-op on an already-empty bin", async () => {
    state.docs.set(TRASH_ID, {
      id: TRASH_ID,
      title: "Trash Bin",
      document: { id: TRASH_ID, title: "Trash Bin", clips: [] },
      clips: [],
      ownerUid: "user-a",
      revision: 7,
    });

    const response = await emptyTrash();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, cleared: 0 });
    // No write at all: the revision is untouched.
    expect(state.docs.get(TRASH_ID)?.revision).toBe(7);
  });

  it("leaves another user's trash document alone", async () => {
    seedTrash([clip("c1", "https://example.test/a.png")]);
    state.current.user = { uid: "user-b", email: null, name: null, picture: null };
    const before = state.docs.get(TRASH_ID);

    // user-b empties THEIR bin (which doesn't exist) — user-a's is untouched.
    expect((await emptyTrash()).status).toBe(200);
    expect(state.docs.get(TRASH_ID)).toEqual(before);
  });
});

const discard = (clipIds: unknown) =>
  discardTrash(
    new Request("http://test.local/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clipIds }),
    }),
  );

// POST removes SPECIFIC entries, which is what taking an image back out of the
// bin needs: the drawer shows one row per image, the graph moves one copy into
// the open timeline, and the copies that never moved have to go too — or the
// row returns holding duplicates of something already taken back.
describe("POST /api/trash", () => {
  it("discards the named entries and leaves the rest", async () => {
    seedTrash([
      clip("c1", "https://example.test/a.png"),
      clip("c2", "https://example.test/b.png"),
      clip("c3", "https://example.test/c.png"),
    ]);

    const response = await discard(["c1", "c3"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, discarded: 2 });

    expect(state.docs.get(TRASH_ID)?.clips).toEqual([
      expect.objectContaining({ id: "c2" }),
    ]);
    expect((await readBack()).clips.map((entry) => entry.id)).toEqual(["c2"]);
  });

  it("drops ONE entry per id, not every clip sharing it", async () => {
    // The bin legitimately holds the same id twice: stable per-asset clip ids
    // mean one file trashed from two timelines arrives under one id. A caller
    // discarding one copy must not lose the other.
    seedTrash([
      clip("dup", "https://example.test/a.png"),
      clip("dup", "https://example.test/a.png"),
      clip("c2", "https://example.test/b.png"),
    ]);

    expect(await (await discard(["dup"])).json()).toEqual({ success: true, discarded: 1 });
    expect(state.docs.get(TRASH_ID)?.clips).toEqual([
      expect.objectContaining({ id: "dup" }),
      expect.objectContaining({ id: "c2" }),
    ]);
  });

  it("discarding the LAST entries empties the document and it stays empty", async () => {
    // `allowEmptying` is what makes this work: the save path refuses an empty
    // write over a non-empty document, and the read path otherwise re-hydrates
    // `lastNonEmptyDocument` whenever the stored clips are empty.
    seedTrash([clip("c1", "https://example.test/a.png")]);

    expect(await (await discard(["c1"])).json()).toEqual({ success: true, discarded: 1 });
    expect(state.docs.get(TRASH_ID)?.clips).toEqual([]);
    expect((await readBack()).clips).toEqual([]);
  });

  it("never deletes the uploaded file behind a discarded entry", async () => {
    seedTrash([clip("c1", "https://res.cloudinary.com/demo/image/upload/v1/f/orphan.png")]);
    await discard(["c1"]);
    expect(state.cloudinaryDeletes).toEqual([]);
  });

  it("ignores ids that aren't in the bin, without writing", async () => {
    seedTrash([clip("c1", "https://example.test/a.png")], 5);

    expect(await (await discard(["nope"])).json()).toEqual({ success: true, discarded: 0 });
    expect(state.docs.get(TRASH_ID)?.revision).toBe(5);
    expect(state.docs.get(TRASH_ID)?.clips).toHaveLength(1);
  });

  it("rejects a request with no usable ids", async () => {
    seedTrash([clip("c1", "https://example.test/a.png")]);

    for (const body of [[], ["", "  ".trim()], "c1", undefined]) {
      const response = await discard(body);
      expect(response.status).toBe(400);
    }
    expect(state.docs.get(TRASH_ID)?.clips).toHaveLength(1);
  });

  it("leaves another user's trash document alone", async () => {
    seedTrash([clip("c1", "https://example.test/a.png")]);
    state.current.user = { uid: "user-b", email: null, name: null, picture: null };
    const before = state.docs.get(TRASH_ID);

    // The id exists — in SOMEONE ELSE'S bin. The handler only ever reads the
    // caller's own `trash-<uid>` document, so there is nothing to remove.
    expect(await (await discard(["c1"])).json()).toEqual({ success: true, discarded: 0 });
    expect(state.docs.get(TRASH_ID)).toEqual(before);
  });
});
