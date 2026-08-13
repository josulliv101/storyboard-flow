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


function collectionClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: id,
    childTimelineId: id,
    alt: `${id} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  } as TimelineClip;
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


  // ── THE STORE'S REFUSALS ARE ANSWERS, NOT CRASHES ─────────────────────────
  //
  // The catch here handled a revision conflict and an access denial and
  // rethrew everything else. The store has two other refusals — the empty
  // guard and the orphan guard — and both left this surface as a raw
  // exception with no explanation. A refusal is a decision the caller has to
  // read and act on, so it belongs in the result.

  it("reports the empty-collection refusal instead of throwing", async () => {
    seed("root", [collectionClip("src"), collectionClip("dst")]);
    seed("src", [clip("only")]);
    seed("dst", [clip("other")]);

    // No allowEmptying: this stands in for any command that empties a source
    // without meaning to. `move_clip` now passes the flag; this is the path
    // taken when something does not.
    const result = await applyCollectionsCommand(
      "root",
      {
        type: "move-nodes",
        nodeIds: [parseNodeId("only")],
        toParentId: parseNodeId("dst"),
        toIndex: 1,
      },
      OWNER,
    );

    expect(result.ok).toBe(false);
    // Narrowed rather than cast: a "rejected" outcome carries a structured
    // rejection and no message, and this must be the plain-error kind.
    if (result.ok || result.kind !== "error") throw new Error("expected an error outcome");
    expect(result.message).toMatch(/would empty a collection/i);
    // Refused means refused — the destination must not have been written
    // either, since the batch is atomic.
    expect(storedClipIds("src")).toEqual(["only"]);
    expect(storedClipIds("dst")).toEqual(["other"]);
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

    // Asserted unconditionally. Guarding on `result.kind === "error"` made this
    // vacuous: a denied read is swallowed into an EMPTY substitute document, so
    // the root IS present and the failure arrives as a reducer `rejected`
    // (missing node), never the `error` branch — the assertions never ran.
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    // Whatever shape it takes, it must not say WHY — knowing an id is not a
    // claim to it.
    const message =
      result.kind === "error" ? result.message : JSON.stringify(result.rejection);
    expect(message).not.toMatch(/authoriz|permission|owner/i);
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

// A DETAILS-ONLY change: no graph mutation, so no command and no patch. The
// write set is normally derived from the patch, so this path exists precisely
// because there is nothing to derive it from — and its failure mode is a silent
// `ok: true` with nothing written, which is what these cover.
describe("applyCollectionsCommand — details-only writes", () => {
  it("persists a detail change with no command at all", async () => {
    seed("root", [clip("a"), clip("b")]);

    const result = await applyCollectionsCommand(
      "root",
      (_graph, details) => ({
        ok: true,
        details: { a: { ...details.a, tags: ["keeper", "S02"] } },
        affectedCollectionIds: ["root"],
      }),
      OWNER,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the write to succeed");
    expect(result.affectedIds).toEqual(["root"]);
    const stored = (state.docs.get("root") as { clips: TimelineClip[] }).clips;
    expect(stored.find((c) => c.id === "a")?.tags).toEqual(["keeper", "S02"]);
    // The rest of the document is untouched — a details-only write still
    // rebuilds the WHOLE clip list, so losing a sibling here is a real risk.
    expect(stored.map((c) => c.id)).toEqual(["a", "b"]);
    expect(stored.find((c) => c.id === "b")?.tags).toBeUndefined();
  });

  it("leaves every other stored field on the clip intact", async () => {
    // The builder spreads the existing detail; if it did not, the clip would be
    // rebuilt without its provenance and the file would leak.
    // `clip()` is typed as the whole TimelineClip union, and a collection has no
    // `sourceAsset` — narrow before spreading rather than casting past it.
    const base = clip("a");
    if (base.kind === "collection") throw new Error("fixture must be a media clip");
    seed("root", [{ ...base, sourceAsset: { providerId: "cloudinary", assetId: "x/y" } }]);

    await applyCollectionsCommand(
      "root",
      (_graph, details) => ({
        ok: true,
        details: { a: { ...details.a, tags: ["keeper"] } },
        affectedCollectionIds: ["root"],
      }),
      OWNER,
    );

    const stored = (state.docs.get("root") as { clips: TimelineClip[] }).clips[0];
    if (stored.kind === "collection") throw new Error("expected a media clip");
    expect(stored.sourceAsset).toEqual({ providerId: "cloudinary", assetId: "x/y" });
    expect(stored.tags).toEqual(["keeper"]);
  });

  it("bumps the revision so a concurrent writer still loses", async () => {
    seed("root", [clip("a")], OWNER, 4);

    await applyCollectionsCommand(
      "root",
      (_graph, details) => ({
        ok: true,
        details: { a: { ...details.a, tags: ["keeper"] } },
        affectedCollectionIds: ["root"],
      }),
      OWNER,
    );

    expect((state.docs.get("root") as { revision: number }).revision).toBe(5);
  });

  it("reports an error rather than a silent success when the declared document is not loaded", async () => {
    // The empty-affected short-circuit is correct for a patch-derived set, but
    // for a DECLARED one it would report success having written nothing.
    seed("root", [clip("a")]);

    const result = await applyCollectionsCommand(
      "root",
      () => ({ ok: true, details: {}, affectedCollectionIds: ["not-loaded"] }),
      OWNER,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected an error outcome");
    expect(result.message).toContain("not-loaded");
  });
});
