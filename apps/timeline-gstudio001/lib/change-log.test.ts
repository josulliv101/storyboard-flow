import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

// The change log is the record that did not exist when a project silently
// reverted — so what is worth pinning is not "it writes a row" but the three
// properties that make it trustworthy: it records the clip ids (the thing that
// actually identifies a structural change), it records WHICH surface wrote, and
// it can never fail the user's save.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const added: Stored[] = [];
  let addThrows = false;
  let queryThrows: Error | null = null;
  let queryResult: Stored[] = [];
  const queryCalls: { where?: unknown[]; orderBy?: unknown[]; limit?: number }[] = [];

  const query = () => {
    // Records the chain so a test can assert the query SHAPE — the shape is
    // what the composite index has to match, and a mismatch there is exactly
    // the failure this suite exists for. Recorded on `where`, not here: every
    // recordChange call goes through collection() too, and counting those
    // would leave the read assertions reading someone else's writes.
    const call: { where?: unknown[]; orderBy?: unknown[]; limit?: number } = {};
    const chain = {
      where: (...args: unknown[]) => {
        call.where = args;
        queryCalls.push(call);
        return chain;
      },
      orderBy: (...args: unknown[]) => {
        call.orderBy = args;
        return chain;
      },
      limit: (value: number) => {
        call.limit = value;
        return chain;
      },
      get: async () => {
        if (queryThrows) throw queryThrows;
        return { docs: queryResult.map((data) => ({ data: () => data })) };
      },
    };
    return chain;
  };

  const db = {
    collection: () => ({
      add: async (data: Stored) => {
        if (addThrows) throw new Error("firestore unavailable");
        added.push(data);
        return { id: `entry-${added.length}` };
      },
      ...query(),
    }),
  };
  return {
    added,
    db,
    queryCalls,
    setAddThrows: (value: boolean) => {
      addThrows = value;
    },
    setQueryThrows: (error: Error | null) => {
      queryThrows = error;
    },
    setQueryResult: (rows: Stored[]) => {
      queryResult = rows;
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TIME" },
}));

import { changeLogDocuments, recentChanges, recordChange } from "./change-log";

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

function doc(id: string, clipIds: string[]): TimelineDocument {
  return { id, title: id, clips: clipIds.map(clip) };
}

beforeEach(() => {
  state.added.length = 0;
  state.queryCalls.length = 0;
  state.setAddThrows(false);
  state.setQueryThrows(null);
  state.setQueryResult([]);
});

describe("recordChange", () => {
  it("records the clip ids, so a structural change is reconstructable", async () => {
    await recordChange({
      uid: "user-a",
      source: "mcp",
      documents: changeLogDocuments(
        [{ id: "scene", revision: 8 }],
        { scene: doc("scene", ["a", "b"]) },
        { scene: 7 },
      ),
    });

    expect(state.added).toHaveLength(1);
    const entry = state.added[0] as {
      uid: string;
      source: string;
      timelineIds: string[];
      documents: { id: string; fromRevision?: number; toRevision: number; clipIds: string[] }[];
    };
    expect(entry.uid).toBe("user-a");
    expect(entry.source).toBe("mcp");
    // Denormalized for querying — Firestore cannot index into an array of objects.
    expect(entry.timelineIds).toEqual(["scene"]);
    expect(entry.documents[0]).toMatchObject({
      id: "scene",
      fromRevision: 7,
      toRevision: 8,
      clipIds: ["a", "b"],
    });
  });

  it("distinguishes the app from the agent", async () => {
    await recordChange({
      uid: "user-a",
      source: "app",
      documents: changeLogDocuments([{ id: "scene", revision: 2 }], { scene: doc("scene", []) }),
    });

    expect((state.added[0] as { source: string }).source).toBe("app");
  });

  it("omits fromRevision for a create rather than inventing one", async () => {
    await recordChange({
      uid: "user-a",
      source: "app",
      // No prior revision known — a compare-and-set create.
      documents: changeLogDocuments([{ id: "fresh", revision: 1 }], { fresh: doc("fresh", ["x"]) }),
    });

    expect(state.added[0]).toMatchObject({ documents: [{ id: "fresh", toRevision: 1 }] });
    expect((state.added[0] as { documents: Stored[] }).documents[0]).not.toHaveProperty(
      "fromRevision",
    );
  });

  it("NEVER throws — a logging failure must not fail the write", async () => {
    state.setAddThrows(true);

    await expect(
      recordChange({
        uid: "user-a",
        source: "app",
        documents: changeLogDocuments([{ id: "scene", revision: 2 }], { scene: doc("scene", []) }),
      }),
    ).resolves.toBeUndefined();
  });

  it("writes nothing when no document changed", async () => {
    await recordChange({ uid: "user-a", source: "app", documents: [] });

    expect(state.added).toHaveLength(0);
  });
});

// The log has been written faithfully for weeks; the one helper built to read
// it could never run. array-contains combined with an orderBy needs a
// composite index, and there wasn't one — so every call threw
// FAILED_PRECONDITION, and nothing called it, so nobody found out.
describe("recentChanges", () => {
  it("asks the question the composite index is declared for", async () => {
    state.setQueryResult([{ uid: "user-a", source: "app" }]);

    const rows = await recentChanges("scene", 10);

    expect(rows).toEqual([{ uid: "user-a", source: "app" }]);
    // Pinned because firestore.indexes.json has to MATCH this shape. If the
    // field or the direction moves here and not there, the query starts
    // throwing again in exactly the way that went unnoticed before.
    expect(state.queryCalls[0]).toEqual({
      where: ["timelineIds", "array-contains", "scene"],
      orderBy: ["at", "desc"],
      limit: 10,
    });
  });

  it("turns a missing index into the command that fixes it", async () => {
    const missing = Object.assign(
      new Error("9 FAILED_PRECONDITION: The query requires an index. Create it here: https://console.firebase.google.com/x"),
      { code: 9 },
    );
    state.setQueryThrows(missing);

    await expect(recentChanges("scene")).rejects.toThrow(
      /firebase deploy --only firestore:indexes/,
    );
    // Firestore's own message carries a one-click link to create the index, so
    // it must survive being wrapped rather than be replaced by ours.
    await expect(recentChanges("scene")).rejects.toThrow(/console\.firebase\.google\.com/);
  });

  it("does NOT dress up an unrelated failure as a missing index", async () => {
    state.setQueryThrows(new Error("permission denied"));

    // The wrong diagnosis is worse than none: it would send someone to deploy
    // an index that is already there.
    await expect(recentChanges("scene")).rejects.toThrow(/^permission denied$/);
  });

  it("propagates the failure rather than reporting an empty history", async () => {
    state.setQueryThrows(new Error("firestore unavailable"));

    // recordChange swallows on purpose; this must not. An empty array here
    // reads as "nothing ever touched this timeline", which is the opposite of
    // the truth and the exact wrong answer during an investigation.
    await expect(recentChanges("scene")).rejects.toThrow();
  });
});
