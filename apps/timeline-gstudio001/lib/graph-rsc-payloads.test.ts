import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { at } from "../lib/test-support/at";

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
  /** Per-id storage read count — the loader must not re-read a document it
   *  already pulled in to derive a parent's summaries. */
  const reads = new Map<string, number>();
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
  return { docs, reads, db };
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
  state.reads.clear();
});

describe("loadGraphBootstrapPayloads", () => {
  it("serves the project and the user's trash with their revisions", async () => {
    seed("project-1", "user-a", [image("a", 0, 4)], 5);
    seed("trash-user-a", "user-a", [image("t", 0, 4)], 2);

    const payloads = (await loadGraphBootstrapPayloads("project-1", "user-a"))?.payloads ?? null;
    expect(payloads).not.toBeNull();
    expect(payloads!.map((payload) => [payload.document.id, payload.revision])).toEqual([
      ["project-1", 5],
      ["trash-user-a", 2],
    ]);
  });

  it("serves an unstored trash as an empty revision-0 document", async () => {
    seed("project-1", "user-a", [image("a", 0, 4)]);
    const payloads = (await loadGraphBootstrapPayloads("project-1", "user-a"))?.payloads ?? null;
    expect(at(payloads ?? [], 1).document.clips).toEqual([]);
    expect(at(payloads ?? [], 1).revision).toBe(0);
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

  it("focusedOnly (soft navigation) serves just the focused tail plus its children", async () => {
    seed("grand", "user-a", [image("g", 0, 2)]);
    seed("scene", "user-a", [image("s", 0, 2), collectionClip("gref", "grand", 2)], 4);
    seed("mid", "user-a", [collectionClip("sref", "scene", 0)], 3);

    const payloads = await loadFocusPathPayloads(["mid", "scene"], "user-a", {
      focusedOnly: true,
    });
    expect(payloads.map((payload) => payload.document.id)).toEqual(["scene", "grand"]);
  });

  it("skips unloadable segments and never repeats a document", async () => {
    seed("scene", "user-a", [collectionClip("self", "scene", 0)], 4);

    const payloads = await loadFocusPathPayloads(["ghost", "scene", "scene"], "user-a");
    expect(payloads.map((payload) => payload.document.id)).toEqual(["scene"]);
  });

  // Serving a document already reads every child to derive its collection
  // summaries. Serving those children as payloads then read each of them a
  // second time, and their own children a third.
  it("reads each document once across summary derivation and payload serving", async () => {
    seed("grand", "user-a", [image("g", 0, 2)]);
    seed("scene", "user-a", [collectionClip("gref", "grand", 0)]);
    seed("mid", "user-a", [collectionClip("sref", "scene", 0)]);
    state.reads.clear();

    await loadFocusPathPayloads(["mid", "scene"], "user-a");

    expect([...state.reads.values()].every((count) => count === 1)).toBe(true);
  });

  // MAX_PATH_PAYLOADS counts SUCCESSES, so it bounded nothing when nothing
  // resolved: `activeTimelinePath` is a catch-all segment, so a URL with
  // hundreds of unknown segments cost one storage read each while producing
  // no payloads at all.
  it("bounds storage reads for a path of unresolvable segments", async () => {
    const segments = Array.from({ length: 300 }, (_, index) => `ghost-${index}`);
    state.reads.clear();

    const payloads = await loadFocusPathPayloads(segments, "user-a");

    expect(payloads).toEqual([]);
    expect(state.reads.size).toBeLessThanOrEqual(48);
  });
});
