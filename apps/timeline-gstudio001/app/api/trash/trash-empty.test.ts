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
// The Cloudinary double is here to prove a NEGATIVE: emptying the bin must
// never delete an uploaded file. The files stay in the Assets library, where
// they can be placed again; reclaiming storage is a separate, deliberate job.

type Stored = Record<string, unknown>;

const DELETE_SENTINEL = "__delete__";

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const current = {
    user: { uid: "user-a", email: null as string | null, name: null, picture: null },
  };
  const cloudinaryDeletes: { publicId: string; resourceType: string }[] = [];

  const applySet = (id: string, data: Stored, opts?: { merge?: boolean }) => {
    const existing = docs.get(id);
    const merged = opts?.merge && existing ? { ...existing, ...data } : { ...data };
    // Firestore's FieldValue.delete() removes the field on a merge write;
    // the in-memory double honours it so the read-back path is exercised
    // exactly as it runs in production.
    for (const [key, value] of Object.entries(merged)) {
      if (value === "__delete__") delete merged[key];
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
  const db = {
    collection: () => ({
      doc: docRef,
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
  };
  return { docs, current, db, cloudinaryDeletes };
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
  deleteCloudinaryAsset: async (publicId: string, resourceType: string) => {
    state.cloudinaryDeletes.push({ publicId, resourceType });
  },
}));

import { DELETE as emptyTrash, POST as discardTrash } from "./route";
import { GET as getTimeline } from "../timelines/[id]/route";

const TRASH_ID = "trash-user-a";

function clip(id: string, src: string, kind: "image" | "video" = "image"): TimelineClip {
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
  } as TimelineClip;
}

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

/** A LIVE (non-trash) document that still points at `srcs`. */
function seedLiveTimeline(id: string, srcs: string[]) {
  const clips = srcs.map((src, index) => clip(`${id}-c${index}`, src));
  state.docs.set(id, {
    id,
    title: id,
    document: { id, title: id, clips },
    clips,
    ownerUid: "user-a",
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
    expect(await response.json()).toEqual({ success: true, cleared: 2 });

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

  it("NEVER deletes an uploaded file, whoever else does or doesn't use it", async () => {
    // Every shape the old asset-deleting version treated differently: a
    // Cloudinary image, a Cloudinary video, an asset placed in a live
    // timeline, and one placed nowhere else at all. None of them is touched —
    // the files stay in the Assets library.
    const orphan = "https://res.cloudinary.com/demo/image/upload/v1/folder/orphan.png";
    const shared = "https://res.cloudinary.com/demo/image/upload/v1/folder/shared.png";
    seedTrash([
      clip("c1", orphan),
      clip("c2", shared),
      clip("c3", "https://res.cloudinary.com/demo/video/upload/v1/folder/movie.mp4", "video"),
      clip("c4", "https://example.test/not-cloudinary.png"),
    ]);
    seedLiveTimeline("project-live", [shared]);

    const response = await emptyTrash();
    expect(await response.json()).toEqual({ success: true, cleared: 4 });
    expect(state.cloudinaryDeletes).toEqual([]);
    // The bin still emptied — that is the whole job.
    expect(state.docs.get(TRASH_ID)?.clips).toEqual([]);
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
