import { describe, expect, it } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { parseNodeId, type CollectionItemNode } from "@storyboard/ui/dnd-collections";
import type { ClipDetail } from "@storyboard/timeline-domain";

import { cloneNodeForInsert, type CloneDeps } from "./graph-node-clone";

/** A deterministic minter so ids are predictable and collision-free in tests. */
function counterMint(): CloneDeps["mintId"] {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

function imageClip(id: string, src: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    src,
  };
}

function collectionClip(id: string, childTimelineId: string, title: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title,
    childTimelineId,
    itemCount: 1,
    alt: title,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  };
}

/** Every id that exists in the SOURCE — none may appear in the clone. */
const SOURCE_IDS = ["S", "SUB", "c1", "c2", "c3", "clip-in-parent"];

function readerFor(docs: Record<string, TimelineDocument>): CloneDeps["readDocument"] {
  return (id) => docs[id] ?? null;
}

function allIds(doc: TimelineDocument): string[] {
  return [doc.id, ...doc.clips.map((clip) => clip.id)];
}

describe("cloneNodeForInsert: media", () => {
  it("mints a fresh id, copies the props, and needs no new document", () => {
    const node: CollectionItemNode = {
      id: parseNodeId("m1"),
      kind: "media",
      mediaKind: "image",
      name: "Pic",
      src: "https://cdn/pic.png",
      durationSeconds: 4,
    };
    const detail: ClipDetail = {
      alt: "Pic",
      aspect: 16 / 9,
      trackIndex: 0,
      // Must be dropped: reusing it would collide with the source clip.
      sourceClipId: "m1",
    };

    const result = cloneNodeForInsert(node, detail, {
      readDocument: () => null,
      mintId: counterMint(),
    });

    expect(result.node.id).not.toBe("m1");
    expect(result.node.kind).toBe("media");
    expect(result.node).toMatchObject({ mediaKind: "image", src: "https://cdn/pic.png", name: "Pic" });
    expect(result.newDocuments).toEqual([]);
    expect(result.detail).toBeDefined();
    expect(result.detail).not.toHaveProperty("sourceClipId");
  });
});

describe("cloneNodeForInsert: collection deep clone", () => {
  const docs: Record<string, TimelineDocument> = {
    S: { id: "S", title: "Root", clips: [imageClip("c1", "a.png"), collectionClip("c2", "SUB", "Sub")] },
    SUB: { id: "SUB", title: "Sub", clips: [imageClip("c3", "b.png")] },
  };
  const node: CollectionItemNode = { id: parseNodeId("S"), kind: "collection", name: "Root" };
  const detail: ClipDetail = {
    alt: "Root",
    aspect: 16 / 9,
    trackIndex: 0,
    itemCount: 2,
    duration: 10,
    hydrated: false,
    sourceClipId: "clip-in-parent",
  };

  it("remaps every id, emits one new document per collection, and rewires child refs", () => {
    const result = cloneNodeForInsert(node, detail, {
      readDocument: readerFor(docs),
      mintId: counterMint(),
    });

    // One new document per cloned collection (root + nested).
    expect(result.newDocuments).toHaveLength(2);
    const root = result.newDocuments.find((doc) => doc.clips.length === 2)!;
    const sub = result.newDocuments.find((doc) => doc.clips.length === 1)!;
    expect(root).toBeDefined();
    expect(sub).toBeDefined();

    // The inserted node IS the fresh root timeline.
    expect(result.node.id).toBe(root.id);
    expect(result.node).toMatchObject({ kind: "collection", name: "Root" });

    // The root's collection clip points at the NEW nested id, not the old one.
    const nestedClip = root.clips.find((clip) => clip.kind === "collection")!;
    expect(nestedClip.kind).toBe("collection");
    if (nestedClip.kind === "collection") {
      expect(nestedClip.childTimelineId).toBe(sub.id);
    }

    // Media content is preserved through the clone.
    const rootImage = root.clips.find((clip) => clip.kind === "image");
    expect(rootImage && rootImage.kind === "image" ? rootImage.src : null).toBe("a.png");
    const subImage = sub.clips[0];
    expect(subImage.kind === "image" ? subImage.src : null).toBe("b.png");

    // NOTHING from the source survives as an id anywhere in the clone.
    const cloneIds = new Set([result.node.id, ...result.newDocuments.flatMap(allIds)]);
    for (const sourceId of SOURCE_IDS) {
      expect(cloneIds.has(sourceId)).toBe(false);
    }

    // The clone is an independent, un-hydrated placeholder.
    expect(result.detail?.hydrated).toBe(false);
    expect(result.detail).not.toHaveProperty("sourceClipId");
    expect(result.detail).not.toHaveProperty("duplicateOfTimelineId");
  });

  it("clones the REFERENCED timeline when the source is a duplicate-reference", () => {
    const refNode: CollectionItemNode = { id: parseNodeId("ref-card"), kind: "collection", name: "Ref" };
    const refDetail: ClipDetail = {
      alt: "Ref",
      aspect: 16 / 9,
      trackIndex: 0,
      hydrated: false,
      duplicateOfTimelineId: "S",
    };

    const result = cloneNodeForInsert(refNode, refDetail, {
      readDocument: readerFor(docs),
      mintId: counterMint(),
    });

    // It followed the reference to S and deep-cloned that tree (2 documents),
    // not the empty "ref-card" node.
    expect(result.newDocuments).toHaveLength(2);
    const cloneIds = new Set([result.node.id, ...result.newDocuments.flatMap(allIds)]);
    expect(cloneIds.has("S")).toBe(false);
    expect(cloneIds.has("ref-card")).toBe(false);
    expect(result.detail).not.toHaveProperty("duplicateOfTimelineId");
  });
});
