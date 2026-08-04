import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "@storyboard/timeline-model/types";

// `read_timeline` against the same in-memory Firestore double the rest of
// lib/mcp uses, so the store, the closure walk and the summary derivation all
// run for real.
//
// The thing worth proving: this tool SERVES the document rather than returning
// the stored record. Collection summaries live denormalized on the PARENT's
// clip and writes are patch-scoped, so a stored parent carries whatever it was
// last told — which for a collection of collections is usually nothing at all.
// Every fixture below stores a deliberately WRONG summary and asserts the
// derived one comes back.

type Stored = Record<string, unknown>;

const state = vi.hoisted(() => {
  const docs = new Map<string, Stored>();
  const snapshot = (id: string) => {
    const data = docs.get(id);
    return {
      id,
      exists: data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => (data ? data[field] : undefined),
    };
  };
  const db = {
    collection: () => ({
      doc: (id: string) => ({ id, get: async () => snapshot(id) }),
      where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
    }),
  };
  return { docs, db };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseDb: () => state.db }));
vi.mock("@/lib/cloudinary-media-store", () => ({ listCloudinaryAssets: async () => [] }));
vi.mock("firebase-admin/firestore", () => {
  class Timestamp {
    toDate() {
      return new Date(0);
    }
  }
  return { Timestamp, FieldValue: { serverTimestamp: () => new Timestamp(), delete: () => null } };
});

import { handleReadTimeline } from "./read-timeline";

const OWNER = "user-a";

function image(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://example.test/${id}.jpg`,
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

/** A collection clip carrying the summary the PARENT last stored for it —
 *  which is exactly the value a raw read would hand back. */
function collectionClip(
  id: string,
  stale: { itemCount: number; previewItems?: CollectionTimelineClip["previewItems"] },
): CollectionTimelineClip {
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
    itemCount: stale.itemCount,
    previewItems: stale.previewItems ?? [],
  };
}

function seed(id: string, clips: TimelineClip[], ownerUid = OWNER) {
  state.docs.set(id, { id, title: id, clips, ownerUid, revision: 1 });
}

function payloadOf(result: Awaited<ReturnType<typeof handleReadTimeline>>): TimelineDocument {
  const json = result.content[1];
  if (!json || !("text" in json)) throw new Error("no JSON block in result");
  return (JSON.parse(json.text) as { timeline: TimelineDocument }).timeline;
}

/** The served clip at `index`, narrowed to the collection variant — the
 *  summary fields under test exist only there. */
function servedCollection(
  result: Awaited<ReturnType<typeof handleReadTimeline>>,
  index = 0,
): CollectionTimelineClip {
  const clip = payloadOf(result).clips[index];
  if (clip.kind !== "collection") throw new Error(`clip ${index} is ${clip.kind}, not a collection`);
  return clip;
}

function textOf(result: Awaited<ReturnType<typeof handleReadTimeline>>): string {
  return result.content.map((part) => ("text" in part ? part.text : "")).join(" ");
}

beforeEach(() => {
  state.docs.clear();
});

describe("handleReadTimeline", () => {
  it("derives previewItems the stored parent never had", async () => {
    // The reported bug: a run folder holding real renders showed the agent
    // `previewItems: []`, because nothing writes preview frames onto a parent
    // whose own children are collections.
    seed("root", [collectionClip("run-1", { itemCount: 0 })]);
    seed("run-1", [image("shot-a"), image("shot-b")]);

    const result = await handleReadTimeline({ timelineId: "root" }, { requesterUid: OWNER });

    expect(servedCollection(result).previewItems?.map((item) => item.id)).toEqual([
      "shot-a",
      "shot-b",
    ]);
  });

  it("corrects an itemCount left over from an earlier shape of the tree", async () => {
    seed("root", [collectionClip("run-1", { itemCount: 6 })]);
    seed("run-1", [image("only")]);

    const result = await handleReadTimeline({ timelineId: "root" }, { requesterUid: OWNER });

    expect(servedCollection(result).itemCount).toBe(1);
  });

  it("derives through a collection of collections, not just one level down", async () => {
    // Bottom-up across the whole closure. One level would leave `scene` reading
    // its child's STORED (empty) summary and still report no preview frames.
    seed("root", [collectionClip("scene", { itemCount: 99 })]);
    seed("scene", [collectionClip("run-1", { itemCount: 99 })]);
    seed("run-1", [image("deep")]);

    const result = await handleReadTimeline({ timelineId: "root" }, { requesterUid: OWNER });

    const scene = servedCollection(result);
    expect(scene.itemCount).toBe(1);
    expect(scene.previewItems?.map((item) => item.id)).toEqual(["deep"]);
  });

  it("summarizes the document for the agent in the first text block", async () => {
    seed("root", [image("a"), collectionClip("run-1", { itemCount: 0 })]);
    seed("run-1", []);

    const result = await handleReadTimeline({ timelineId: "root" }, { requesterUid: OWNER });

    expect(result.content[0].text).toContain("2 clips");
    expect(result.content[0].text).toContain("run-1 (collection)");
  });

  it("reports a missing document without throwing", async () => {
    const result = await handleReadTimeline({ timelineId: "nope" }, { requesterUid: OWNER });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No timeline document with id "nope"');
  });

  it("refuses another account's timeline", async () => {
    seed("root", [image("a")], "someone-else");

    const result = await handleReadTimeline({ timelineId: "root" }, { requesterUid: OWNER });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Not authorized");
  });
});
