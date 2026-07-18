import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// RSC payload-loader tests over the REAL serve path (heal + read-time
// summary derivation) against the in-memory fake Firestore: bootstrap
// serves project + trash with revisions, focus paths serve each segment
// plus one eager child level, and every failure mode (missing project,
// denied project, unloadable segment) degrades to fewer payloads instead
// of throwing into the layout.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();

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
  return { docs, db };
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
vi.mock("@/lib/cloudinary-media-store", () => ({
  listCloudinaryAssets: async () => [],
}));

import { loadFocusPathPayloads, loadGraphBootstrapPayloads } from "./graph-rsc-payloads";

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

function collectionClip(id: string, childTimelineId: string, startTime: number): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: childTimelineId,
    childTimelineId,
    itemCount: 1,
    alt: childTimelineId,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration: 3,
    sourceDuration: 3,
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
});

describe("loadGraphBootstrapPayloads", () => {
  it("serves the project and the user's trash with their revisions", async () => {
    seed("project-1", "user-a", [image("a", 0, 4)], 5);
    seed("trash-user-a", "user-a", [image("t", 0, 4)], 2);

    const payloads = await loadGraphBootstrapPayloads("project-1", "user-a");
    expect(payloads).not.toBeNull();
    expect(payloads!.map((payload) => [payload.document.id, payload.revision])).toEqual([
      ["project-1", 5],
      ["trash-user-a", 2],
    ]);
  });

  it("serves an unstored trash as an empty revision-0 document", async () => {
    seed("project-1", "user-a", [image("a", 0, 4)]);
    const payloads = await loadGraphBootstrapPayloads("project-1", "user-a");
    expect(payloads![1].document.clips).toEqual([]);
    expect(payloads![1].revision).toBe(0);
  });

  it("returns null for a missing or foreign project — the client boot handles it", async () => {
    expect(await loadGraphBootstrapPayloads("project-none", "user-a")).toBeNull();

    seed("project-b", "user-b", [image("x", 0, 4)]);
    expect(await loadGraphBootstrapPayloads("project-b", "user-a")).toBeNull();
  });
});

describe("loadFocusPathPayloads", () => {
  it("serves every path segment plus one eager child level under the focused one", async () => {
    seed("grand", "user-a", [image("g", 0, 2)]);
    seed("scene", "user-a", [image("s", 0, 2), collectionClip("gref", "grand", 2)], 4);
    seed("mid", "user-a", [collectionClip("sref", "scene", 0)], 3);

    const payloads = await loadFocusPathPayloads(["mid", "scene"], "user-a");
    expect(payloads.map((payload) => [payload.document.id, payload.revision])).toEqual([
      ["mid", 3],
      ["scene", 4],
      ["grand", 1],
    ]);
  });

  it("skips unloadable segments and never repeats a document", async () => {
    seed("scene", "user-a", [collectionClip("self", "scene", 0)], 4);

    const payloads = await loadFocusPathPayloads(["ghost", "scene", "scene"], "user-a");
    expect(payloads.map((payload) => payload.document.id)).toEqual(["scene"]);
  });
});
