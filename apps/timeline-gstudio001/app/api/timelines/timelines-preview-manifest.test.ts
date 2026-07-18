import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaybackManifest } from "@storyboard/timeline-domain";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Preview-manifest tests over the REAL route handler, closure loader, and
// store against the in-memory fake Firestore: the nested closure flattens
// into leaves, unloadable branches (missing or another user's) degrade to
// silence and are reported, foreign roots 404, and stored reference cycles
// come back as an honest 409.

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

import { GET as getPreviewManifest } from "./[id]/preview-manifest/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function image(id: string, startTime: number, duration: number): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function collectionClip(
  id: string,
  childTimelineId: string,
  startTime: number,
  duration: number,
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    childTimelineId,
    itemCount: 0,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function seed(id: string, ownerUid: string, clips: TimelineClip[], revision = 1) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { id, title: id, document, clips, ownerUid, revision });
}

beforeEach(() => {
  state.docs.clear();
  state.current.user = { uid: "user-a", email: null, name: null, picture: null };
});

describe("preview manifest route", () => {
  it("flattens the nested closure into absolute-time leaves with the root revision", async () => {
    seed("scene", "user-a", [image("a", 0, 2), image("b", 2, 2)]);
    seed(
      "root-1",
      "user-a",
      [image("intro", 0, 4), collectionClip("scene-ref", "scene", 4, 4)],
      9,
    );

    const response = await getPreviewManifest(new Request("http://test.local"), params("root-1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { manifest: PlaybackManifest; missing: string[] };

    expect(body.missing).toEqual([]);
    expect(body.manifest.projectRevision).toBe(9);
    expect(body.manifest.durationSeconds).toBe(8);
    expect(body.manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro", "a", "b"]);
    expect(body.manifest.leaves[1].collectionPath).toEqual(["root-1", "scene"]);
    expect(body.manifest.leaves[1].timelineStart).toBeCloseTo(4, 6);
  });

  it("degrades unloadable branches to silence and reports them", async () => {
    // "ghost" doesn't exist; "theirs" belongs to another user — both branches
    // must fall silent without failing the preview.
    seed("theirs", "user-b", [image("x", 0, 4)]);
    seed(
      "root-1",
      "user-a",
      [
        image("intro", 0, 2),
        collectionClip("ghost-ref", "ghost", 2, 2),
        collectionClip("theirs-ref", "theirs", 4, 2),
      ],
    );

    const response = await getPreviewManifest(new Request("http://test.local"), params("root-1"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { manifest: PlaybackManifest; missing: string[] };

    expect(body.manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro"]);
    expect([...body.missing].sort()).toEqual(["ghost", "theirs"]);
  });

  it("returns 404 for another user's root", async () => {
    seed("root-b", "user-b", [image("x", 0, 4)]);
    const response = await getPreviewManifest(new Request("http://test.local"), params("root-b"));
    expect(response.status).toBe(404);
  });

  it("reports a stored reference cycle as 409", async () => {
    seed("loop-a", "user-a", [collectionClip("to-b", "loop-b", 0, 2)]);
    seed("loop-b", "user-a", [collectionClip("to-a", "loop-a", 0, 2)]);

    const response = await getPreviewManifest(new Request("http://test.local"), params("loop-a"));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Collection cycle detected/);
  });
});
