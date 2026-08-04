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
  const db = {
    collection: () => ({
      add: async (data: Stored) => {
        if (addThrows) throw new Error("firestore unavailable");
        added.push(data);
        return { id: `entry-${added.length}` };
      },
    }),
  };
  return {
    added,
    db,
    setAddThrows: (value: boolean) => {
      addThrows = value;
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "SERVER_TIME" },
}));

import { changeLogDocuments, recordChange } from "./change-log";

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
  state.setAddThrows(false);
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
