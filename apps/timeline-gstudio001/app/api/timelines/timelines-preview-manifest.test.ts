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
  /** Per-id read counter — the closure walk must not fetch a document the
   *  caller already handed it. */
  const reads = new Map<string, number>();
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
    get: async () => {
      reads.set(id, (reads.get(id) ?? 0) + 1);
      return snapshot(id);
    },
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
  return { docs, reads, current, db };
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
import { serveTimelineDocument } from "@/lib/serve-timeline";

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
  state.reads.clear();
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
    // Read-time summary derivation repacks, so the collection clip sits one
    // CLIP_GAP_SECONDS after "intro" rather than at the un-gapped startTime
    // this fixture stores — the same normalization the GET route already
    // applies, which is the point: both read models report one timeline.
    expect(body.manifest.durationSeconds).toBeCloseTo(8.12, 6);
    expect(body.manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro", "a", "b"]);
    expect(body.manifest.leaves[1].collectionPath).toEqual(["root-1", "scene"]);
    expect(body.manifest.leaves[1].timelineStart).toBeCloseTo(4.12, 6);
  });


  // #284 asked whether this route needs a server-side cache, and said to
  // measure first. It does not, and this is the measurement kept as a guard.
  //
  // A 7-document closure costs exactly 7 reads — one per document, no repeats
  // — because `createTimelineEntryReader` dedupes within a request. And the
  // client fetches this on focus change and 2500ms after a commit settles
  // (MANIFEST_REFRESH_DELAY_MS), not on a poll, so requests are per edit
  // BURST rather than per second.
  //
  // What this test protects is the "one read per document" part. An N+1 —
  // re-reading a child while walking, say — would not fail any existing test;
  // it would just quietly multiply the cost of every preview, which is the
  // thing that would eventually make a cache necessary.
  it("costs one read per document in the closure, and no more", async () => {
    const sceneIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = `scene-${index}`;
      sceneIds.push(id);
      seed(id, "user-a", [
        image(`${id}-a`, 0, 2),
        image(`${id}-b`, 2, 2),
        image(`${id}-c`, 4, 2),
        image(`${id}-d`, 6, 2),
      ]);
    }
    seed(
      "root-1",
      "user-a",
      sceneIds.map((id, index) => collectionClip(`${id}-ref`, id, index * 8, 8)),
    );

    state.reads.clear();
    await getPreviewManifest(new Request("http://test.local"), params("root-1"));

    const documents = sceneIds.length + 1;
    const total = [...state.reads.values()].reduce((sum, count) => sum + count, 0);
    expect(state.reads.size).toBe(documents);
    expect(total).toBe(documents);
    // Every document read exactly once — not "mostly once".
    expect([...state.reads.values()].every((count) => count === 1)).toBe(true);
  });

  it("reads the root exactly once", async () => {
    seed("scene", "user-a", [image("a", 0, 2)]);
    seed("root-1", "user-a", [collectionClip("scene-ref", "scene", 0, 2)]);
    state.reads.clear();

    await getPreviewManifest(new Request("http://test.local"), params("root-1"));

    // The route's own read IS the 404 check; the closure walker used to fetch
    // the same document again and have its result overwritten.
    expect(state.reads.get("root-1")).toBe(1);
  });

  it("refuses a closure larger than the document ceiling", async () => {
    // A chain longer than MAX_CLOSURE_DOCUMENTS. Unbounded, this walked every
    // link serially until the platform killed the function.
    const length = 520;
    for (let index = 0; index < length; index += 1) {
      const next = index + 1 < length ? [collectionClip(`c${index}`, `t${index + 1}`, 0, 2)] : [];
      seed(`t${index}`, "user-a", next);
    }

    const response = await getPreviewManifest(new Request("http://test.local"), params("t0"));

    expect(response.status).toBe(409);
    const { error } = (await response.json()) as { error: string };
    expect(error).toMatch(/more than 500 documents/);
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

  it("summarizes stale parents from the child, matching what the GET route serves", async () => {
    // The graph view's writes are patch-scoped: nesting a clip into "scene"
    // rewrites ONLY "scene", leaving every referring parent's denormalized
    // summary short. Every other read path repairs that at read time
    // (serveTimelineDocument); the manifest must agree, or the preview plays
    // a different timeline than the board shows.
    seed("scene", "user-a", [image("a", 0, 2), image("b", 2.12, 2), image("c", 4.24, 2.65)]);
    seed("root-1", "user-a", [
      image("intro", 0, 4),
      // Stale: written when "scene" was still two clips long.
      collectionClip("scene-ref", "scene", 4.12, 4),
    ]);

    const served = await serveTimelineDocument("root-1", "user-a");
    const servedClips = served?.document.clips ?? [];
    const last = servedClips[servedClips.length - 1];
    const servedDuration = last.startTime + last.duration;

    const response = await getPreviewManifest(new Request("http://test.local"), params("root-1"));
    const body = (await response.json()) as { manifest: PlaybackManifest; missing: string[] };

    expect(body.manifest.durationSeconds).toBeCloseTo(servedDuration, 6);
    // The stale span also windowed the child's newest clip out of playback.
    expect(body.manifest.leaves.map((leaf) => leaf.id)).toEqual(["intro", "a", "b", "c"]);
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
