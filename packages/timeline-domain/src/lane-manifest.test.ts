import { describe, expect, it } from "vitest";

import { packTimelineClips } from "@storyboard/timeline-model/documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { compilePlaybackManifest } from "./playback-manifest";

// What the manifest says about LANES — the read model export and the player
// both consume, so "is this leaf picture or under-layer" gets decided here
// exactly once.

function media(
  id: string,
  duration: number,
  over: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.png`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
    ...over,
  } as TimelineClip;
}

function collection(
  id: string,
  childTimelineId: string,
  duration: number,
  over: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    childTimelineId,
    title: id,
    itemCount: 1,
    previewItems: [],
    alt: `${id} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
    ...over,
  } as unknown as TimelineClip;
}

const doc = (id: string, clips: TimelineClip[]): TimelineDocument => ({
  id,
  title: id,
  clips: packTimelineClips(clips),
});

const compile = (documents: Record<string, TimelineDocument>, root = "root") =>
  compilePlaybackManifest(documents, root, 1, "2026-08-15T00:00:00.000Z");

const laneOf = (manifest: ReturnType<typeof compile>, id: string) =>
  manifest.leaves.find((leaf) => leaf.id === id)?.trackIndex;

describe("manifest lanes", () => {
  it("puts everything on the picture when nothing uses lanes", () => {
    const manifest = compile({ root: doc("root", [media("a", 4), media("b", 4)]) });
    expect(manifest.leaves.map((leaf) => leaf.trackIndex)).toEqual([0, 0]);
  });

  it("EMITS OVERLAPPING LEAVES for a bed under the picture", () => {
    // The whole point of phase 2: two leaves live at the same instant.
    const manifest = compile({
      root: doc("root", [
        media("shot-1", 4),
        media("shot-2", 4),
        media("bed", 30, { trackIndex: 1, kind: "audio", src: "https://cdn.test/bed.wav" }),
      ]),
    });
    const bed = manifest.leaves.find((leaf) => leaf.id === "bed");
    const shot2 = manifest.leaves.find((leaf) => leaf.id === "shot-2");
    expect(bed?.timelineStart).toBe(0);
    expect(bed?.trackIndex).toBe(1);
    // shot-2 starts while the bed is still running — they overlap.
    expect(shot2!.timelineStart).toBeGreaterThan(0);
    expect(shot2!.timelineStart).toBeLessThan(bed!.timelineStart + bed!.timelineDuration);
  });

  it("reports the whole timeline's duration as the FURTHEST lane end", () => {
    const manifest = compile({
      root: doc("root", [media("shot", 4), media("bed", 30, { trackIndex: 1 })]),
    });
    expect(manifest.durationSeconds).toBe(30);
  });

  it("compiles a PLACED clip at the time it was placed", () => {
    // #400, and the reason the read side needed no changes: the manifest has
    // always read `clip.startTime`, so a start the packer honours arrives here
    // on its own. This is what the render mixes against, so it is where
    // "placed at 7.5s" becomes "audible at 7.5s".
    const manifest = compile({
      root: doc("root", [
        media("shot", 30),
        media("vo", 2, {
          trackIndex: 1,
          placedStart: 7.5,
          kind: "audio",
          src: "https://cdn.test/vo.wav",
        }),
      ]),
    });
    const vo = manifest.leaves.find((leaf) => leaf.id === "vo");
    expect(vo?.timelineStart).toBe(7.5);
    expect(vo?.trackIndex).toBe(1);
    // And the picture is where it always was.
    expect(manifest.leaves.find((leaf) => leaf.id === "shot")?.timelineStart).toBe(0);
  });

  it("a bed inside a lane-0 collection is UNDER — its own lane decides", () => {
    const manifest = compile({
      root: doc("root", [collection("scene", "scene-doc", 20)]),
      "scene-doc": doc("scene-doc", [
        media("shot", 4),
        media("bed", 20, { trackIndex: 1 }),
      ]),
    });
    expect(laneOf(manifest, "shot")).toBe(0);
    expect(laneOf(manifest, "bed")).toBe(1);
  });

  it("EVERYTHING inside a lane-1 collection is under, however it is arranged", () => {
    // The outermost placement decides the role. A shot on lane 0 inside a
    // collection that was itself placed under the picture is still under it.
    const manifest = compile({
      root: doc("root", [
        media("picture", 10),
        collection("under", "under-doc", 10, { trackIndex: 1 }),
      ]),
      "under-doc": doc("under-doc", [media("inner", 10)]),
    });
    expect(laneOf(manifest, "picture")).toBe(0);
    expect(laneOf(manifest, "inner")).toBe(1);
  });

  it("does NOT let an inner lane override an outer one", () => {
    // A lane-2 clip inside a lane-1 collection is still "under the picture at
    // lane 1" — the inner index only described that collection's own layout,
    // which the window math has already resolved.
    const manifest = compile({
      root: doc("root", [collection("under", "under-doc", 10, { trackIndex: 1 })]),
      "under-doc": doc("under-doc", [media("deep", 10, { trackIndex: 2 })]),
    });
    expect(laneOf(manifest, "deep")).toBe(1);
  });

  it("normalises a phantom lane to the picture", () => {
    const manifest = compile({
      root: doc("root", [media("odd", 4, { trackIndex: -3 })]),
    });
    expect(laneOf(manifest, "odd")).toBe(0);
  });

  it("keeps carrying disabled independently of the lane", () => {
    const manifest = compile({
      root: doc("root", [
        media("shot", 4),
        media("bed", 20, { trackIndex: 1, disabled: true }),
      ]),
    });
    expect(manifest.leaves.find((leaf) => leaf.id === "bed")).toMatchObject({
      trackIndex: 1,
      disabled: true,
    });
  });
});

// WHERE A LAYER DRAWS. Absent means sound only, which is what every layered
// clip did before compositing — so the manifest must not invent one.

const INSET = { x: 0.65, y: 0.6, width: 0.3 };
const frameOf = (manifest: ReturnType<typeof compile>, id: string) =>
  manifest.leaves.find((leaf) => leaf.id === id)?.layerFrame;

describe("manifest layer frames", () => {
  it("carries the inset on a layered clip", () => {
    const manifest = compile({
      root: doc("root", [
        media("shot", 10),
        media("pip", 4, { trackIndex: 1, kind: "video", layerFrame: INSET }),
      ]),
    });
    expect(frameOf(manifest, "pip")).toEqual(INSET);
  });

  it("emits NOTHING for a layer without one — sound only", () => {
    const manifest = compile({
      root: doc("root", [media("shot", 10), media("bed", 4, { trackIndex: 1 })]),
    });
    expect(frameOf(manifest, "bed")).toBeUndefined();
    expect("layerFrame" in manifest.leaves[1]!).toBe(false);
  });

  it("DROPS a stale inset left on a clip that is back on the picture", () => {
    // Moving a clip to lane 0 clears the frame on the write path, but a
    // document written by anything else can still carry one. Lane 0 has
    // nothing to be inset within, so it is not an instruction.
    const manifest = compile({
      root: doc("root", [media("shot", 10, { layerFrame: INSET })]),
    });
    expect(frameOf(manifest, "shot")).toBeUndefined();
  });

  it("does NOT inherit a collection's inset onto its children", () => {
    // Lane is inherited — the outermost non-zero one wins, because "picture or
    // under-layer" is settled by the outermost thing. A RECTANGLE is not:
    // a frame on the scene says where the SCENE sits, and there is no defined
    // composition of that with a frame inside it. So each leaf answers for
    // itself, and a leaf that never had one has none.
    const manifest = compile({
      root: doc("root", [
        media("shot", 10),
        collection("scene", "child", 6, { trackIndex: 1, layerFrame: INSET }),
      ]),
      child: doc("child", [media("inner", 6)]),
    });
    // Under the picture, because the collection above it is…
    expect(laneOf(manifest, "inner")).toBe(1);
    // …but with no frame of its own.
    expect(frameOf(manifest, "inner")).toBeUndefined();
  });

  it("keeps a leaf's OWN inset inside a layered collection", () => {
    const manifest = compile({
      root: doc("root", [
        media("shot", 10),
        collection("scene", "child", 6, { trackIndex: 1 }),
      ]),
      child: doc("child", [media("inner", 6, { layerFrame: INSET })]),
    });
    expect(frameOf(manifest, "inner")).toEqual(INSET);
  });

  it("drops a rectangle that is not one", () => {
    const manifest = compile({
      root: doc("root", [
        media("shot", 10),
        media("pip", 4, {
          trackIndex: 1,
          layerFrame: { x: 0.5, y: 0.5, width: 0 } as unknown as typeof INSET,
        }),
      ]),
    });
    expect(frameOf(manifest, "pip")).toBeUndefined();
  });
});
