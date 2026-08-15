import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "@storyboard/collections-core";

import { defaultLayerFrame, defaultLayerFramePlacement, hasPicture } from "./default-layer-frame";

// A clip dropped on a lane has to be VISIBLE, or the gesture is the same dead
// end lanes themselves were before the empty lane row: you do it, nothing
// happens, you conclude the feature is broken. But absence has to keep meaning
// "sound only" so no stored document changes what it exports — so the default
// is stamped on the way IN rather than inferred on the way out.

function graphOf(specs: readonly GraphNodeSpec[]) {
  const built = buildGraph([{ kind: "collection", id: "root", name: "Root", children: specs }]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

const nodeIn = (specs: readonly GraphNodeSpec[], id: string) =>
  graphOf(specs).nodesById.get(parseNodeId(id));

describe("hasPicture", () => {
  it("is true for an image, a video, and a whole nested scene", () => {
    const specs: GraphNodeSpec[] = [
      { kind: "media", id: "img", name: "img" },
      {
        kind: "media",
        mediaKind: "video",
        id: "vid",
        name: "vid",
        fullDurationSeconds: 5,
        trimInSeconds: 0,
        trimOutSeconds: 0,
      },
      { kind: "collection", id: "scene", name: "scene", children: [] },
    ];
    for (const id of ["img", "vid", "scene"]) {
      expect(hasPicture(nodeIn(specs, id))).toBe(true);
    }
  });

  it("is FALSE for audio — a voiceover has nowhere to be drawn", () => {
    const specs: GraphNodeSpec[] = [
      {
        kind: "media",
        mediaKind: "audio",
        id: "vo",
        name: "vo",
        fullDurationSeconds: 5,
        trimInSeconds: 0,
        trimOutSeconds: 0,
      },
    ];
    expect(hasPicture(nodeIn(specs, "vo"))).toBe(false);
  });

  it("is false for a node that is not there", () => {
    expect(hasPicture(undefined)).toBe(false);
  });
});

describe("defaultLayerFrame", () => {
  it("is a real rectangle inside the frame, in the bottom-right", () => {
    const frame = defaultLayerFrame(16 / 9);
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.x).toBeGreaterThan(0.5);
    expect(frame.x + frame.width).toBeLessThanOrEqual(1);
  });

  it("falls back to widescreen for a clip with no recorded aspect", () => {
    expect(defaultLayerFrame(undefined)).toEqual(defaultLayerFrame(16 / 9));
  });

  it("MOVES with the aspect — a tall clip does not sit where a wide one does", () => {
    // The frame is stored without a height, so `y` has to absorb the shape.
    // If these matched, the stored rectangle would be ignoring the clip.
    expect(defaultLayerFrame(9 / 16).y).not.toBe(defaultLayerFrame(16 / 9).y);
  });
});

describe("defaultLayerFramePlacement", () => {
  const specs: GraphNodeSpec[] = [
    { kind: "media", id: "img", name: "img" },
    {
      kind: "media",
      mediaKind: "audio",
      id: "vo",
      name: "vo",
      fullDurationSeconds: 5,
      trimInSeconds: 0,
      trimOutSeconds: 0,
    },
    { kind: "media", id: "framed", name: "framed", layerFrame: { x: 0.1, y: 0.1, width: 0.2 } },
  ];

  it("gives a picture clip the default", () => {
    expect(defaultLayerFramePlacement(nodeIn(specs, "img"), { aspect: 16 / 9 })).toEqual({
      layerFrame: defaultLayerFrame(16 / 9),
    });
  });

  it("gives AUDIO nothing — a bed on a lane is still just sound", () => {
    expect(defaultLayerFramePlacement(nodeIn(specs, "vo"), { aspect: 16 / 9 })).toEqual({});
  });

  it("leaves an existing frame alone, so moving between lanes keeps the position", () => {
    expect(defaultLayerFramePlacement(nodeIn(specs, "framed"), { aspect: 16 / 9 })).toEqual({});
  });

  it("still works with no detail recorded for the clip", () => {
    expect(defaultLayerFramePlacement(nodeIn(specs, "img"), undefined)).toEqual({
      layerFrame: defaultLayerFrame(undefined),
    });
  });
});
