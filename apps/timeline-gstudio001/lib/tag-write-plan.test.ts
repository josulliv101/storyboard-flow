import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId } from "@storyboard/collections-core";
import type { DetailsById } from "@storyboard/timeline-domain";

import { isTagWriteRefusal, planTagWrite, type TagWritePlan } from "./tag-write-plan";

// Editing tags is the one graph-view mutation with no command behind it, so
// nothing downstream can catch a mistake here: `detailsStore.merge()` emits no
// patch, PersistenceBridge never fires, and a wrong answer shows correct chips
// that vanish on reload.

const graph = (() => {
  const built = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "Root",
      children: [
        { kind: "media", id: "clip-a", name: "A", durationSeconds: 4 },
        {
          kind: "collection",
          id: "inner",
          name: "Inner",
          children: [{ kind: "media", id: "clip-b", name: "B", durationSeconds: 4 }],
        },
      ],
    },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
})();

const details: DetailsById = {
  root: { alt: "Root", aspect: 16 / 9, trackIndex: 0, hydrated: true },
  "clip-a": {
    alt: "A",
    aspect: 16 / 9,
    trackIndex: 0,
    poster: "https://example.test/a.jpg",
    sourceAsset: { providerId: "cloudinary", assetId: "x/a" },
  },
  inner: { alt: "Inner", aspect: 16 / 9, trackIndex: 0, hydrated: true },
  "clip-b": { alt: "B", aspect: 16 / 9, trackIndex: 0, tags: ["old"] },
};

function plan(nodeId: string, tags: string[]): TagWritePlan {
  const result = planTagWrite(graph, details, parseNodeId(nodeId), tags);
  if (isTagWriteRefusal(result)) throw new Error(`refused: ${result.reason}`);
  return result;
}

describe("planTagWrite", () => {
  it("names the clip's own parent, and only that", () => {
    // A clip is stored in its parent's `clips` array, and a tag changes no
    // ancestor's summary — not duration, not itemCount, not previewItems. This
    // mirrors the server rule in handleSetTags; the two surfaces must agree.
    expect(plan("clip-a", ["keeper"]).parentId).toBe("root");
    expect(plan("clip-b", ["keeper"]).parentId).toBe("inner");
  });

  it("keeps every other field on the detail", () => {
    // The merge rebuilds the stored clip. Dropping poster or sourceAsset here
    // would erase provenance and leak the file.
    const { detail } = plan("clip-a", ["keeper"]);
    expect(detail.poster).toBe("https://example.test/a.jpg");
    expect(detail.sourceAsset).toEqual({ providerId: "cloudinary", assetId: "x/a" });
    expect(detail.alt).toBe("A");
    expect(detail.tags).toEqual(["keeper"]);
  });

  it("normalizes on the way in", () => {
    const { detail, tags } = plan("clip-a", ["  Keeper ", "keeper", "", "S02"]);
    expect(tags).toEqual(["Keeper", "S02"]);
    expect(detail.tags).toEqual(["Keeper", "S02"]);
  });

  it("clearing REMOVES the key rather than storing an empty array", () => {
    // Absence is what "untagged" means everywhere else in this model; an empty
    // array would make a document grow a field it does not use.
    const { detail } = plan("clip-b", []);
    expect("tags" in detail).toBe(false);
  });

  it("does not mutate the details it was given", () => {
    const before = JSON.stringify(details);
    plan("clip-b", ["something-else"]);
    expect(JSON.stringify(details)).toBe(before);
  });

  it("refuses a root — a timeline is not a clip in anyone's document", () => {
    const result = planTagWrite(graph, details, parseNodeId("root"), ["x"]);
    expect(isTagWriteRefusal(result)).toBe(true);
    if (!isTagWriteRefusal(result)) throw new Error("expected a refusal");
    expect(result.reason).toBe("is-root");
  });

  it("refuses an unknown node", () => {
    const result = planTagWrite(graph, details, parseNodeId("nope"), ["x"]);
    expect(isTagWriteRefusal(result)).toBe(true);
  });

  it("refuses a node with no detail entry rather than writing a bare one", () => {
    // Writing `{tags}` alone would rebuild the clip without its alt, poster or
    // sourceAsset — the erasure this refusal exists to prevent.
    const thin: DetailsById = { root: details.root };
    const result = planTagWrite(graph, thin, parseNodeId("clip-a"), ["x"]);
    expect(isTagWriteRefusal(result)).toBe(true);
    if (!isTagWriteRefusal(result)) throw new Error("expected a refusal");
    expect(result.reason).toBe("no-detail");
  });
});
