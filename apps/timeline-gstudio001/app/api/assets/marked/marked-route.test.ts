import { beforeEach, describe, expect, it, vi } from "vitest";

// The recently-deleted list and its Keep action, over the REAL handlers and the
// REAL tombstone store — only Firestore and the session are faked.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const tombstones = new Map<string, Stored>();
  const current = {
    user: { uid: "user-a", email: null as string | null, name: null, picture: null },
  };

  const snapshot = (id: string) => ({
    id,
    exists: tombstones.has(id),
    data: () => {
      const data = tombstones.get(id);
      return data ? { ...data } : undefined;
    },
  });
  const docRef = (id: string) => ({
    id,
    get: async () => snapshot(id),
    set: async (data: Stored) => {
      tombstones.set(id, { ...data });
    },
    delete: async () => {
      tombstones.delete(id);
    },
  });
  const db = {
    collection: () => ({
      doc: docRef,
      where: (field: string, _op: string, value: unknown) => ({
        orderBy: () => ({ limit: () => ({ get: async () => rows(field, value) }) }),
        limit: () => ({ get: async () => rows(field, value) }),
        get: async () => rows(field, value),
      }),
    }),
    batch: () => {
      const writes: (() => void)[] = [];
      return {
        set: (ref: { id: string }, data: Stored) => {
          writes.push(() => tombstones.set(ref.id, { ...data }));
        },
        delete: (ref: { id: string }) => {
          writes.push(() => tombstones.delete(ref.id));
        },
        commit: async () => {
          for (const write of writes) write();
        },
      };
    },
  };
  const rows = (field: string, value: unknown) => ({
    docs: [...tombstones.entries()]
      .filter(([, data]) => data[field] === value)
      .map(([id]) => snapshot(id)),
  });
  return { tombstones, current, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("@/lib/firebase-auth-session", () => ({
  requireAuthUser: async () => ({ user: state.current.user, response: null }),
}));

import { markAssetsForDeletion } from "@/lib/asset-tombstones";

import { DELETE as keepAssets, GET as listMarked } from "./route";

const DAY = 24 * 60 * 60 * 1000;

type MarkedRow = {
  providerId: string;
  assetId: string;
  name: string;
  thumbnailUrl: string;
  deleteAfterMs: number;
};

const mark = (
  ownerUid: string,
  assetId: string,
  overrides: Partial<{ name: string; thumbnailUrl: string; markedAt: number }> = {},
) =>
  markAssetsForDeletion(
    ownerUid,
    [
      {
        ref: { providerId: "cloudinary", assetId },
        kind: "image",
        name: overrides.name ?? assetId,
        thumbnailUrl: overrides.thumbnailUrl ?? `https://cdn.test/${assetId}`,
      },
    ],
    overrides.markedAt ?? Date.now(),
  );

const list = async (): Promise<MarkedRow[]> => {
  const response = await listMarked();
  const body = (await response.json()) as { assets: MarkedRow[] };
  return body.assets;
};

const keep = (assets: unknown) =>
  keepAssets(
    new Request("http://test.local/api/assets/marked", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets }),
    }),
  );

beforeEach(() => {
  state.tombstones.clear();
  state.current.user = { uid: "user-a", email: null, name: null, picture: null };
});

describe("GET /api/assets/marked", () => {
  it("prints from the tombstone's own snapshot, with no provider call", async () => {
    // There is no clip left to derive a name or a thumbnail from — that is
    // what being marked MEANS — so the record has to carry them.
    await mark("user-a", "gstudio/user-a/beach.png", {
      name: "Beach, take 3",
      thumbnailUrl: "https://cdn.test/beach-thumb.jpg",
    });

    expect(await list()).toEqual([
      expect.objectContaining({
        providerId: "cloudinary",
        assetId: "gstudio/user-a/beach.png",
        name: "Beach, take 3",
        thumbnailUrl: "https://cdn.test/beach-thumb.jpg",
        kind: "image",
      }),
    ]);
  });

  it("puts the soonest deadline first", async () => {
    await mark("user-a", "later.png", { markedAt: Date.now() });
    await mark("user-a", "sooner.png", { markedAt: Date.now() - 10 * DAY });

    expect((await list()).map((row) => row.assetId)).toEqual(["sooner.png", "later.png"]);
  });

  it("shows only the caller's own marks", async () => {
    await mark("user-a", "mine.png");
    await mark("user-b", "theirs.png");

    expect((await list()).map((row) => row.assetId)).toEqual(["mine.png"]);
  });

  it("is empty when nothing is marked", async () => {
    expect(await list()).toEqual([]);
  });
});

describe("DELETE /api/assets/marked", () => {
  it("keeps the named asset by dropping its mark", async () => {
    await mark("user-a", "keep-me.png");
    await mark("user-a", "let-go.png");

    const response = await keep([{ providerId: "cloudinary", assetId: "keep-me.png" }]);
    expect(await response.json()).toEqual({ success: true, kept: 1 });
    expect((await list()).map((row) => row.assetId)).toEqual(["let-go.png"]);
  });

  it("cannot reach another user's mark", async () => {
    await mark("user-b", "theirs.png");

    // Tombstone ids are owner-scoped, so this names a record that does not
    // exist for THIS caller rather than one it is allowed to touch.
    await keep([{ providerId: "cloudinary", assetId: "theirs.png" }]);
    state.current.user = { uid: "user-b", email: null, name: null, picture: null };
    expect((await list()).map((row) => row.assetId)).toEqual(["theirs.png"]);
  });

  it("rejects a request naming no usable asset", async () => {
    await mark("user-a", "still-here.png");

    for (const body of [[], "not-an-array", [{ providerId: "cloudinary" }], [{ assetId: "x" }]]) {
      expect((await keep(body)).status).toBe(400);
    }
    expect(await list()).toHaveLength(1);
  });
});
