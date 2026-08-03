import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// Server-side command path. Only the process boundary is faked — an in-memory
// Firestore with an all-or-nothing runTransaction, same shape as
// app/api/timelines/timelines-batch.test.ts. The store, the graph adapter and
// the collections reducer are all REAL, because the thing worth proving is that
// a command round-trips document -> graph -> document without losing clips, and
// that the revision CAS still aborts a stale write.

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
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp() } };
});

import { parseNodeId } from "@storyboard/ui/dnd-collections";

import { applyCollectionsCommand } from "./apply-command";

const OWNER = "user-a";

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

function seed(id: string, clips: TimelineClip[], ownerUid = OWNER, revision = 1) {
  const document: TimelineDocument = { id, title: id, clips };
  state.docs.set(id, { ...document, ownerUid, revision });
  return document;
}

function storedClipIds(id: string): string[] {
  const data = state.docs.get(id) as { clips?: TimelineClip[] } | undefined;
  return (data?.clips ?? []).map((c) => c.id);
}

beforeEach(() => {
  state.docs.clear();
});

describe("applyCollectionsCommand", () => {
  it("reorders clips within one document and persists the new order", async () => {
    seed("root", [clip("a"), clip("b"), clip("c")]);

    const result = await applyCollectionsCommand(
      "root",
      { type: "move-nodes", nodeIds: [parseNodeId("c")], toParentId: parseNodeId("root"), toIndex: 0 },
      OWNER,
    );

    expect(result.ok).toBe(true);
    expect(storedClipIds("root")).toEqual(["c", "a", "b"]);
  });

  it("keeps every clip — a move must not drop siblings on the write-back", async () => {
    seed("root", [clip("a"), clip("b"), clip("c"), clip("d")]);

    await applyCollectionsCommand(
      "root",
      { type: "move-nodes", nodeIds: [parseNodeId("a")], toParentId: parseNodeId("root"), toIndex: 2 },
      OWNER,
    );

    expect(storedClipIds("root").sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("renames a clip through the reducer", async () => {
    seed("root", [clip("a")]);

    const result = await applyCollectionsCommand(
      "root",
      { type: "rename-node", nodeId: parseNodeId("a"), name: "Opening shot" },
      OWNER,
    );

    expect(result.ok).toBe(true);
    const stored = state.docs.get("root") as { clips: TimelineClip[] };
    expect(stored.clips[0].title).toBe("Opening shot");
  });

  it("surfaces a reducer refusal as a rejection rather than throwing", async () => {
    seed("root", [clip("a")]);

    const result = await applyCollectionsCommand(
      "root",
      { type: "move-nodes", nodeIds: [parseNodeId("nope")], toParentId: parseNodeId("root"), toIndex: 0 },
      OWNER,
    );

    expect(result).toMatchObject({ ok: false, kind: "rejected" });
    if (!result.ok && result.kind === "rejected") {
      expect(result.rejection.reason).toBe("missing-node");
    }
    expect(storedClipIds("root")).toEqual(["a"]);
  });

  it("refuses another account's document without revealing that it exists", async () => {
    seed("root", [clip("a")], "someone-else");

    const result = await applyCollectionsCommand(
      "root",
      { type: "move-nodes", nodeIds: [parseNodeId("a")], toParentId: parseNodeId("root"), toIndex: 0 },
      OWNER,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "error") {
      // Same wording as a genuinely absent id — knowing an id is not a claim to it.
      expect(result.message).toContain("No timeline document");
      expect(result.message).not.toMatch(/authoriz|permission|owner/i);
    }
    expect(storedClipIds("root")).toEqual(["a"]);
  });

  it("aborts when the document changed after it was read (revision CAS)", async () => {
    seed("root", [clip("a"), clip("b")]);

    // A concurrent writer bumps the revision between our read and our write.
    const original = state.db.runTransaction;
    state.db.runTransaction = (async (fn: Parameters<typeof original>[0]) => {
      const existing = state.docs.get("root") as Stored;
      state.docs.set("root", { ...existing, revision: (existing.revision as number) + 5 });
      state.db.runTransaction = original;
      return original(fn);
    }) as typeof original;

    const result = await applyCollectionsCommand(
      "root",
      { type: "move-nodes", nodeIds: [parseNodeId("b")], toParentId: parseNodeId("root"), toIndex: 0 },
      OWNER,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === "error") {
      expect(result.message).toMatch(/changed while|try again/i);
    }
    // The stale write must not have landed.
    expect(storedClipIds("root")).toEqual(["a", "b"]);
  });
});
