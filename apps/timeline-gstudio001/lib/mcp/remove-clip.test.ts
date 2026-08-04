import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// `remove_clip` end to end, against the same in-memory Firestore double the rest
// of lib/mcp uses — the store, the graph adapter and the reducer all run for
// real, because the thing worth proving is that a removal reaches a bin that
// lives OUTSIDE the project's closure.
//
// It could not, before: `trashId` was a required argument sourced "from
// read_timeline", but the trash is a sibling root and never appears in a project
// read, so every call failed with `No trash collection with id`.

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
  type Tx = {
    get: (ref: { id: string }) => Promise<ReturnType<typeof snapshot>>;
    set: (ref: { id: string }, data: Stored, opts?: { merge?: boolean }) => void;
  };
  const db = {
    collection: () => ({
      doc: docRef,
      where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    }),
    runTransaction: async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
      const staged: Array<[string, Stored, { merge?: boolean } | undefined]> = [];
      const tx: Tx = {
        get: async (ref) => snapshot(ref.id),
        set: (ref, data, opts) => {
          staged.push([ref.id, data, opts]);
        },
      };
      const result = await fn(tx);
      for (const [id, data, opts] of staged) applySet(id, data, opts);
      return result;
    },
  };
  return { docs, db };
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
    FieldValue: {
      serverTimestamp: () => new Timestamp(),
      // Emptying a collection deletes the `lastNonEmptyDocument` recovery
      // snapshot — without that the next read re-hydrates the removed clips and
      // the empty never sticks.
      delete: () => "__DELETED__",
    },
  };
});

import { saveFirebaseTimelineDocumentsAtomic } from "@/lib/firebase-timeline-store";

import { handleRemoveClip } from "./write-handlers";

const OWNER = "user-a";
const TRASH = `trash-${OWNER}`;

function clip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: "https://example.test/img.jpg",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  };
}

function collectionClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    // A collection clip's stored id equals its childTimelineId — the shape the
    // whole app mints, and the one that used to break the graph build.
    childTimelineId: id,
    alt: `${id} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    itemCount: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

function seed(id: string, clips: TimelineClip[], ownerUid = OWNER, revision = 1) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid, revision });
  return document;
}

function storedClipIds(id: string): string[] {
  const data = state.docs.get(id) as { clips?: TimelineClip[] } | undefined;
  return (data?.clips ?? []).map((c) => c.id);
}

function textOf(result: Awaited<ReturnType<typeof handleRemoveClip>>): string {
  return result.content.map((part) => ("text" in part ? part.text : "")).join(" ");
}

beforeEach(() => {
  state.docs.clear();
});

describe("handleRemoveClip", () => {
  it("removes a clip with no trashId, creating the bin on first use", async () => {
    seed("root", [clip("a"), clip("b")]);

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "a" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("root")).toEqual(["b"]);
    // The bin did not exist — the revision-0 compare-and-set created it.
    expect(storedClipIds(TRASH)).toEqual(["a"]);
  });

  it("appends to a bin that already holds something", async () => {
    seed("root", [clip("a"), clip("keep")]);
    seed(TRASH, [clip("older")]);

    await handleRemoveClip({ timelineId: "root", nodeId: "a" }, { requesterUid: OWNER });

    expect(storedClipIds(TRASH)).toEqual(["older", "a"]);
  });

  it("stamps where the item came from, for the bin's row caption", async () => {
    seed("root", [clip("a"), clip("keep")]);

    await handleRemoveClip({ timelineId: "root", nodeId: "a" }, { requesterUid: OWNER });

    const trashed = (state.docs.get(TRASH) as { clips?: TimelineClip[] }).clips?.[0];
    expect(trashed?.trashedAt).toEqual(expect.any(String));
    // The SOURCE TIMELINE, not the clip's own name.
    expect(trashed?.trashedFrom).toEqual({ timelineId: "root", title: "root" });
  });

  it("removes a COLLECTION, not just media", async () => {
    seed("root", [collectionClip("sub"), clip("keep")]);
    seed("sub", []);

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "sub" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("root")).toEqual(["keep"]);
    expect(storedClipIds(TRASH)).toEqual(["sub"]);
  });

  it("removes the LAST item in a collection", async () => {
    // A per-shot lane holds exactly one clip, so this is the common case, not
    // an edge one. The store's blanket empty-guard used to make it impossible.
    seed("root", [clip("only")]);

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "only" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBeFalsy();
    expect(storedClipIds("root")).toEqual([]);
    expect(storedClipIds(TRASH)).toEqual(["only"]);
  });

  it("drops the recovery snapshot so the empty actually sticks", async () => {
    // `toTimelineDocument` reads `lastNonEmptyDocument` back whenever a stored
    // document has no clips. Leaving it behind would re-hydrate the very clip
    // this removal took out, and the collection would look full again on the
    // next read — an empty that silently undoes itself.
    seed("root", [clip("only")]);

    await handleRemoveClip({ timelineId: "root", nodeId: "only" }, { requesterUid: OWNER });

    const stored = state.docs.get("root") as { lastNonEmptyDocument?: unknown };
    expect(stored.lastNonEmptyDocument).toBe("__DELETED__");
  });

  it("still refuses an empty write that nothing asked for", async () => {
    // The exemption is per-write and only set by a removal. Everything else
    // keeps the guard, because an unexpected empty is a stale client about to
    // erase real work.
    seed("root", [clip("a"), clip("b")]);

    await expect(
      saveFirebaseTimelineDocumentsAtomic(
        [{ document: { id: "root", title: "root", clips: [] }, expectedRevision: 1 }],
        OWNER,
      ),
    ).rejects.toThrow(/Refusing to save an empty timeline/);

    expect(storedClipIds("root")).toEqual(["a", "b"]);
  });

  it("reports an unknown node without touching anything", async () => {
    seed("root", [clip("a")]);

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "nope" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No node with id "nope"');
    expect(storedClipIds("root")).toEqual(["a"]);
  });

  it("cannot reach another account's bin", async () => {
    seed("root", [clip("a")]);
    seed("trash-someone-else", [], "someone-else");

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "a", trashId: "trash-someone-else" },
      { requesterUid: OWNER },
    );

    expect(result.isError).toBe(true);
    expect(storedClipIds("root")).toEqual(["a"]);
    expect(storedClipIds("trash-someone-else")).toEqual([]);
  });

  it("refuses another account's timeline without revealing that it exists", async () => {
    seed("root", [clip("a")], "someone-else");

    const result = await handleRemoveClip(
      { timelineId: "root", nodeId: "a" },
      { requesterUid: OWNER },
    );

    // A denied read is swallowed into an EMPTY substitute document
    // (load-timeline-closure), so the refusal surfaces as "that node isn't
    // here" rather than a 404 — which is the point: a denied id and an absent
    // id have to be indistinguishable.
    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toMatch(/authoriz|permission|owner/i);
    expect(storedClipIds("root")).toEqual(["a"]);
  });
});
