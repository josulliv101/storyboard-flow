import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Empty-the-bin tests over the REAL DELETE handler and the REAL
// firebase-timeline-store save path — only the process boundaries are faked
// (the Firestore SDK, the session cookie, Cloudinary). The endpoint could
// never work before: the save path refuses an empty write over a non-empty
// document, and — had it not thrown — the READ path re-hydrates
// `lastNonEmptyDocument` whenever the stored clips are empty, so the bin
// would have come straight back. Both are pinned here.

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
  // The reference scan reads the whole collection with a cap; `scanFails`
  // stands in for a Firestore error on that read.
  const control = { scanFails: false };
  const db = {
    collection: () => ({
      doc: docRef,
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
      limit: (max: number) => ({
        get: async () => {
          if (control.scanFails) throw new Error("scan exploded");
          return { docs: [...docs.keys()].slice(0, max).map(snapshot) };
        },
      }),
    }),
  };
  return { docs, current, db, cloudinaryDeletes, control };
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

import { DELETE as emptyTrash } from "./route";
import { GET as getTimeline } from "../timelines/[id]/route";
import { MEDIA_SCAN_LIMIT } from "@/lib/firebase-timeline-store";

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
  state.control.scanFails = false;
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
    expect(await response.json()).toEqual({
      success: true,
      cleared: 2,
      assetsDeleted: 0,
      assetsKept: 0,
    });

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

  it("deletes only the Cloudinary-hosted assets, by resource type", async () => {
    seedTrash([
      clip("c1", "https://res.cloudinary.com/demo/image/upload/v1/folder/pic.png"),
      clip("c2", "https://res.cloudinary.com/demo/video/upload/v1/folder/movie.mp4", "video"),
      clip("c3", "https://example.test/not-cloudinary.png"),
    ]);

    expect((await emptyTrash()).status).toBe(200);
    expect(state.cloudinaryDeletes).toEqual([
      { publicId: "folder/pic", resourceType: "image" },
      { publicId: "folder/movie", resourceType: "video" },
    ]);
  });

  it("KEEPS an asset another timeline still points at", async () => {
    // The clip is in the bin, but the same upload is placed in a live
    // timeline — deleting the file would break a timeline the user can see.
    const shared = "https://res.cloudinary.com/demo/image/upload/v1/folder/shared.png";
    const orphan = "https://res.cloudinary.com/demo/image/upload/v1/folder/orphan.png";
    seedTrash([clip("c1", shared), clip("c2", orphan)]);
    seedLiveTimeline("project-live", [shared]);

    const response = await emptyTrash();
    expect(await response.json()).toEqual({
      success: true,
      cleared: 2,
      assetsDeleted: 1,
      assetsKept: 1,
    });
    expect(state.cloudinaryDeletes).toEqual([
      { publicId: "folder/orphan", resourceType: "image" },
    ]);
  });

  it("matches across URL SHAPES — a live poster protects the source file", async () => {
    // The live document kept only a generated poster (transform chain, .jpg);
    // the bin holds the plain source (.mp4). Same asset, and a naive string
    // compare would have deleted it.
    seedTrash([
      clip("c1", "https://res.cloudinary.com/demo/video/upload/v1712/folder/clip.mp4", "video"),
    ]);
    seedLiveTimeline("project-live", [
      "https://res.cloudinary.com/demo/video/upload/so_0.35,w_640,c_fill/folder/clip.jpg",
    ]);

    expect((await emptyTrash()).status).toBe(200);
    expect(state.cloudinaryDeletes).toEqual([]);
  });

  it("deletes an asset only ONCE, however many trashed clips share it", async () => {
    const shared = "https://res.cloudinary.com/demo/image/upload/v1/folder/twice.png";
    seedTrash([clip("c1", shared), clip("c2", shared)]);

    expect((await emptyTrash()).status).toBe(200);
    expect(state.cloudinaryDeletes).toEqual([
      { publicId: "folder/twice", resourceType: "image" },
    ]);
  });

  it("keeps every asset when the collection is bigger than the scan cap", async () => {
    // Past the cap the scan has only seen SOME documents, so "no reference
    // found" stops being evidence of "unreferenced" — and a permanent delete
    // needs evidence.
    seedTrash([clip("c1", "https://res.cloudinary.com/demo/image/upload/v1/folder/pic.png")]);
    for (let i = 0; i < MEDIA_SCAN_LIMIT; i += 1) {
      state.docs.set(`filler-${i}`, { id: `filler-${i}`, title: "f", clips: [] });
    }

    const response = await emptyTrash();
    expect(await response.json()).toMatchObject({ assetsDeleted: 0, assetsKept: 1 });
    expect(state.cloudinaryDeletes).toEqual([]);
    expect(state.docs.get(TRASH_ID)?.clips).toEqual([]);
  });

  it("keeps every asset when the reference scan fails — and still empties the bin", async () => {
    seedTrash([clip("c1", "https://res.cloudinary.com/demo/image/upload/v1/folder/pic.png")]);
    state.control.scanFails = true;

    const response = await emptyTrash();
    expect(await response.json()).toEqual({
      success: true,
      cleared: 1,
      assetsDeleted: 0,
      assetsKept: 1,
    });
    // No evidence either way = no permanent delete. The document still
    // emptied: that is the part the user asked for.
    expect(state.cloudinaryDeletes).toEqual([]);
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
    expect(await response.json()).toEqual({
      success: true,
      cleared: 0,
      assetsDeleted: 0,
      assetsKept: 0,
    });
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
