import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";
import type { CollectionsGraph, NodeId } from "@storyboard/ui/dnd-collections";

import {
  cardDimming,
  cardVideoFrameCount,
  collectionCardItemCount,
  collectionCardSeconds,
  enabledChildCount,
  firstChildIsAudio,
} from "./graph-card-model";

const image = (id: string, disabled = false): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds: 4,
  disabled,
});

const audio = (id: string, disabled = false): GraphNodeSpec => ({
  kind: "media",
  mediaKind: "audio",
  id,
  name: id,
  fullDurationSeconds: 4,
  disabled,
});

const video = (id: string): GraphNodeSpec => ({
  kind: "media",
  mediaKind: "video",
  id,
  name: id,
  fullDurationSeconds: 8,
});

const collection = (id: string, children: readonly GraphNodeSpec[] = []): GraphNodeSpec => ({
  kind: "collection",
  id,
  name: id,
  children,
});

function graphOf(roots: readonly GraphNodeSpec[]): CollectionsGraph {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const idOf = (id: string) => id as NodeId;

describe("enabledChildCount", () => {
  it("counts only the children that are not disabled", () => {
    const graph = graphOf([collection("c", [image("a"), image("b", true), image("d")])]);
    expect(enabledChildCount(graph, idOf("c"))).toBe(2);
  });

  it("is zero for a collection with no children", () => {
    expect(enabledChildCount(graphOf([collection("c")]), idOf("c"))).toBe(0);
  });

  it("is zero for a node id that is not in the graph", () => {
    expect(enabledChildCount(graphOf([collection("c")]), idOf("missing"))).toBe(0);
  });

  it("counts direct children only — a nested collection is one child, not its contents", () => {
    const graph = graphOf([
      collection("outer", [collection("inner", [image("a"), image("b")]), image("c")]),
    ]);
    expect(enabledChildCount(graph, idOf("outer"))).toBe(2);
  });
});

describe("firstChildIsAudio", () => {
  it("is true when the first child is audio", () => {
    const graph = graphOf([collection("c", [audio("a"), image("b")])]);
    expect(firstChildIsAudio(graph, idOf("c"))).toBe(true);
  });

  it("is false when audio is present but not first — the thumbnail slot shows the video", () => {
    const graph = graphOf([collection("c", [video("v"), audio("a")])]);
    expect(firstChildIsAudio(graph, idOf("c"))).toBe(false);
  });

  it("is false for an empty collection", () => {
    expect(firstChildIsAudio(graphOf([collection("c")]), idOf("c"))).toBe(false);
  });

  it("does not skip a disabled first child — it asks what the slot would draw", () => {
    const graph = graphOf([collection("c", [audio("a", true), image("b")])]);
    expect(firstChildIsAudio(graph, idOf("c"))).toBe(true);
  });

  it("is false when the first child is a collection", () => {
    const graph = graphOf([collection("outer", [collection("inner", [audio("a")])])]);
    expect(firstChildIsAudio(graph, idOf("outer"))).toBe(false);
  });
});

describe("cardDimming", () => {
  const at = (
    isDragSource: boolean,
    disabledVisuals: "none" | "inherited" | "self",
    filterMiss: boolean,
  ) => cardDimming({ isDragSource, disabledVisuals, filterMiss });

  it("leaves an ordinary card alone", () => {
    expect(at(false, "none", false)).toEqual({ knockBack: "none", grayscale: false });
  });

  it("reports each cause under its own name", () => {
    expect(at(true, "none", false).knockBack).toBe("drag-source");
    expect(at(false, "self", false).knockBack).toBe("self");
    expect(at(false, "inherited", false).knockBack).toBe("inherited");
    expect(at(false, "none", true).knockBack).toBe("filter-miss");
  });

  it("ranks the drag source above every other cause", () => {
    expect(at(true, "self", true).knockBack).toBe("drag-source");
    expect(at(true, "inherited", true).knockBack).toBe("drag-source");
  });

  it("ranks disabled above a filter miss — off survives clearing the filter", () => {
    expect(at(false, "self", true).knockBack).toBe("self");
    expect(at(false, "inherited", true).knockBack).toBe("inherited");
  });

  it("grayscales self-disabled cards only, and independently of the knock-back", () => {
    expect(at(false, "self", false).grayscale).toBe(true);
    // The pre-split behaviour: a dragged card that is switched off still looks
    // switched off, because the ghost is what shows it at full strength.
    expect(at(true, "self", false)).toEqual({ knockBack: "drag-source", grayscale: true });
    expect(at(false, "inherited", false).grayscale).toBe(false);
    expect(at(false, "none", true).grayscale).toBe(false);
  });
});

describe("cardVideoFrameCount", () => {
  const at = (over: Partial<Parameters<typeof cardVideoFrameCount>[0]> = {}) =>
    cardVideoFrameCount({
      isVideo: true,
      inGrid: false,
      settledFrames: 5,
      fallbackFrames: 3,
      cap: 16,
      ...over,
    });

  it("is one frame for anything that is not a video", () => {
    expect(at({ isVideo: false, settledFrames: 9 })).toBe(1);
  });

  it("is one frame in the grid, where a video is a thumbnail", () => {
    expect(at({ inGrid: true, settledFrames: 9 })).toBe(1);
  });

  it("uses the measured count in the strip", () => {
    expect(at({ settledFrames: 7 })).toBe(7);
  });

  it("falls back to the duration-based guess before the first measurement", () => {
    expect(at({ settledFrames: 0, fallbackFrames: 6 })).toBe(6);
  });

  it("caps a very wide card", () => {
    expect(at({ settledFrames: 40, cap: 16 })).toBe(16);
  });

  it("never drops below one frame, even unmeasured with no fallback", () => {
    expect(at({ settledFrames: 0, fallbackFrames: 0 })).toBe(1);
  });
});

describe("collectionCardItemCount", () => {
  it("uses the live enabled count once hydrated", () => {
    expect(
      collectionCardItemCount({ hydrated: true, enabledChildCount: 3, storedItemCount: 9 }),
    ).toBe(3);
  });

  it("uses the stored summary for a placeholder", () => {
    expect(
      collectionCardItemCount({ hydrated: false, enabledChildCount: 0, storedItemCount: 9 }),
    ).toBe(9);
  });

  it("falls back to the live count when a placeholder has no stored summary", () => {
    expect(
      collectionCardItemCount({
        hydrated: false,
        enabledChildCount: 2,
        storedItemCount: undefined,
      }),
    ).toBe(2);
  });

  it("keeps a stored zero rather than treating it as absent", () => {
    expect(
      collectionCardItemCount({ hydrated: false, enabledChildCount: 4, storedItemCount: 0 }),
    ).toBe(0);
  });
});

describe("collectionCardSeconds", () => {
  it("uses live seconds once hydrated", () => {
    expect(
      collectionCardSeconds({
        hydrated: true,
        liveSeconds: 12.5,
        storedPlayableDuration: 99,
        storedDuration: 99,
      }),
    ).toBe(12.5);
  });

  it("passes a hydrated null through rather than reaching for the stored summary", () => {
    expect(
      collectionCardSeconds({
        hydrated: true,
        liveSeconds: null,
        storedPlayableDuration: 99,
        storedDuration: 99,
      }),
    ).toBeNull();
  });

  it("prefers the stored PLAYABLE duration for a placeholder", () => {
    expect(
      collectionCardSeconds({
        hydrated: false,
        liveSeconds: null,
        storedPlayableDuration: 8,
        storedDuration: 20,
      }),
    ).toBe(8);
  });

  it("falls back to duration for documents saved before the two were split", () => {
    expect(
      collectionCardSeconds({
        hydrated: false,
        liveSeconds: null,
        storedPlayableDuration: undefined,
        storedDuration: 20,
      }),
    ).toBe(20);
  });

  it("is null when a placeholder carries no duration at all", () => {
    expect(
      collectionCardSeconds({
        hydrated: false,
        liveSeconds: null,
        storedPlayableDuration: undefined,
        storedDuration: undefined,
      }),
    ).toBeNull();
  });
});
