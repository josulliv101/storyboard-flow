import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

// The reclaim sweep over the REAL handler, the REAL tombstone store and the
// REAL reference rule — only the process boundaries are faked (Firestore, the
// provider registry, the clock via an injected `deleteAfterMs`).
//
// What these pin is the property the whole design rests on: a tombstone is an
// INTENTION, not an authority. The sweep re-reads the owner's documents and
// spares anything that came back into use, so the marking side is allowed to
// be merely careful.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const tombstones = new Map<string, Stored>();
  const removed: { providerId: string; assetId: string; kind: string; uid: string }[] = [];
  const failing = new Set<string>();

  const snapshot = (store: Map<string, Stored>, id: string) => ({
    id,
    exists: store.has(id),
    data: () => {
      const data = store.get(id);
      return data ? { ...data } : undefined;
    },
  });
  const docRef = (store: Map<string, Stored>) => (id: string) => ({
    id,
    get: async () => snapshot(store, id),
    set: async (data: Stored) => {
      store.set(id, { ...data });
    },
    delete: async () => {
      store.delete(id);
    },
    __store: store,
  });

  type Filter = { field: string; op: string; value: unknown };
  const query = (store: Map<string, Stored>, filters: Filter[]) => {
    const build = (after: string | null, limit: number | null) => ({
      where: (field: string, op: string, value: unknown) =>
        query(store, [...filters, { field, op, value }]).__build(after, limit),
      orderBy: () => build(after, limit),
      // The real call hands back a QueryDocumentSnapshot (see
      // collectOwnedTimelineClips); only its id matters here.
      startAfter: (cursor: { id: string }) => build(cursor.id, limit),
      limit: (next: number) => build(after, next),
      get: async () => {
        const matches = (data: Stored) =>
          filters.every((filter) => {
            const value = data[filter.field];
            if (filter.op === "<=") return typeof value === "number" && value <= Number(filter.value);
            return value === filter.value;
          });
        const rows = [...store.entries()]
          .filter(([, data]) => matches(data))
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .filter(([id]) => after === null || id > after);
        const page = limit === null ? rows : rows.slice(0, limit);
        return { docs: page.map(([id]) => snapshot(store, id)) };
      },
      __build: build,
    });
    return build(null, null);
  };

  const db = {
    collection: (name: string) => {
      const store = name === "gstudioAssetTombstones" ? tombstones : docs;
      return { doc: docRef(store), ...query(store, []) };
    },
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
  };
  return { docs, tombstones, removed, failing, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => "__delete__" } };
});
vi.mock("@/lib/assets/registry", () => ({
  assetProviders: {
    get: (id: string) =>
      id === "cloudinary"
        ? {
            id,
            remove: async (
              ctx: { uid: string },
              target: { assetId: string; kind: string },
            ) => {
              if (state.failing.has(target.assetId)) throw new Error("vendor exploded");
              state.removed.push({ providerId: id, uid: ctx.uid, ...target });
            },
          }
        : // "s3" stands in for a provider that is no longer configured.
          undefined,
  },
}));

import { markAssetsForDeletion } from "@/lib/asset-tombstones";

import { GET as reclaim } from "./route";

const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = "cron-secret";

function clip(id: string, assetId: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://example.test/${assetId}`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    sourceAsset: { providerId: "cloudinary", assetId },
  } as TimelineClip;
}

function seedLiveTimeline(id: string, assetIds: string[], ownerUid = "user-a") {
  const clips = assetIds.map((assetId, index) => clip(`${id}-c${index}`, assetId));
  state.docs.set(id, { id, title: id, document: { id, title: id, clips }, clips, ownerUid });
}

/** Mark an asset with a deadline relative to now — negative days are due. */
async function mark(
  ownerUid: string,
  assetId: string,
  daysFromNow: number,
  providerId = "cloudinary",
  kind: "image" | "video" = "image",
) {
  await markAssetsForDeletion(
    ownerUid,
    [{ ref: { providerId, assetId }, kind, name: assetId, thumbnailUrl: "" }],
    Date.now() + daysFromNow * DAY_MS - 30 * DAY_MS,
  );
}

const sweep = (token = SECRET) =>
  reclaim(
    new Request("http://test.local/api/assets/reclaim", {
      headers: token === "" ? {} : { authorization: `Bearer ${token}` },
    }),
  );

beforeEach(() => {
  state.docs.clear();
  state.tombstones.clear();
  state.removed.length = 0;
  state.failing.clear();
  process.env.CRON_SECRET = SECRET;
});

describe("GET /api/assets/reclaim", () => {
  it("deletes a due tombstone nothing references", async () => {
    await mark("user-a", "gstudio/user-a/orphan.png", 0);

    const body = await (await sweep()).json();
    expect(body).toEqual({ due: 1, deleted: 1, spared: 0, skipped: 0 });
    expect(state.removed).toEqual([
      { providerId: "cloudinary", uid: "user-a", assetId: "gstudio/user-a/orphan.png", kind: "image" },
    ]);
    // The record goes with the file: an intention that outlived its object
    // would be retried forever.
    expect(state.tombstones.size).toBe(0);
  });

  it("SPARES an asset that came back into use, and drops the mark", async () => {
    // The property the grace period exists for: a mark placed by an imperfect
    // scan self-corrects rather than losing a file.
    await mark("user-a", "gstudio/user-a/back.png", 0);
    seedLiveTimeline("project-live", ["gstudio/user-a/back.png"]);

    expect(await (await sweep()).json()).toEqual({ due: 1, deleted: 0, spared: 1, skipped: 0 });
    expect(state.removed).toEqual([]);
    expect(state.tombstones.size).toBe(0);
  });

  it("leaves a tombstone whose 30 days have not run out", async () => {
    await mark("user-a", "gstudio/user-a/waiting.png", 5);

    expect(await (await sweep()).json()).toEqual({ due: 0, deleted: 0, spared: 0, skipped: 0 });
    expect(state.removed).toEqual([]);
    expect(state.tombstones.size).toBe(1);
  });

  it("scopes the reference check to the tombstone's OWNER", async () => {
    // Another user's document referencing the same id must not save it — and
    // must not be readable by this scan at all.
    await mark("user-a", "gstudio/user-a/orphan.png", 0);
    seedLiveTimeline("project-other", ["gstudio/user-a/orphan.png"], "user-b");

    expect(await (await sweep()).json()).toEqual({ due: 1, deleted: 1, spared: 0, skipped: 0 });
    expect(state.removed).toHaveLength(1);
  });

  it("keeps the tombstone when the vendor delete fails", async () => {
    await mark("user-a", "gstudio/user-a/stuck.png", 0);
    state.failing.add("gstudio/user-a/stuck.png");

    expect(await (await sweep()).json()).toEqual({ due: 1, deleted: 0, spared: 0, skipped: 1 });
    expect(state.tombstones.size).toBe(1);
  });

  it("keeps the tombstone when the provider is no longer configured", async () => {
    await mark("user-a", "media/user-a/dropped.png", 0, "s3");

    expect(await (await sweep()).json()).toEqual({ due: 1, deleted: 0, spared: 0, skipped: 1 });
    // Forgetting the intention would strand the object with nothing left to
    // say it should go.
    expect(state.tombstones.size).toBe(1);
  });

  it("passes the recorded kind through, 30 days after the clip is gone", async () => {
    await mark("user-a", "gstudio/user-a/movie.mp4", 0, "cloudinary", "video");

    await sweep();
    expect(state.removed[0]).toMatchObject({ kind: "video" });
  });

  it("sweeps several owners independently", async () => {
    await mark("user-a", "gstudio/user-a/a.png", 0);
    await mark("user-b", "gstudio/user-b/b.png", 0);
    seedLiveTimeline("project-b", ["gstudio/user-b/b.png"], "user-b");

    expect(await (await sweep()).json()).toEqual({ due: 2, deleted: 1, spared: 1, skipped: 0 });
    expect(state.removed).toEqual([
      { providerId: "cloudinary", uid: "user-a", assetId: "gstudio/user-a/a.png", kind: "image" },
    ]);
  });

  it("refuses without the right bearer token", async () => {
    await mark("user-a", "gstudio/user-a/orphan.png", 0);

    for (const token of ["", "wrong-secret", "cron-secret-longer"]) {
      expect((await sweep(token)).status).toBe(401);
    }
    expect(state.removed).toEqual([]);
    expect(state.tombstones.size).toBe(1);
  });

  it("refuses entirely when no secret is configured", async () => {
    // An unset secret must never read as "anyone may run this" — the endpoint
    // deletes files.
    delete process.env.CRON_SECRET;
    await mark("user-a", "gstudio/user-a/orphan.png", 0);

    expect((await sweep()).status).toBe(503);
    expect(state.removed).toEqual([]);
  });
});
