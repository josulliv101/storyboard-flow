import { describe, expect, it } from "vitest";

import { buildGraph, parseNodeId, type GraphNodeSpec } from "@storyboard/collections-core";

import {
  LAYER_FRAME_POSITIONS,
  LAYER_FRAME_SIZES,
} from "@storyboard/timeline-model/layer-frame";

import {
  defaultLayerFrame,
  defaultLayerFramePlacement,
  hasPicture,
  layerFrameForChoice,
  presetForLayerFrame,
} from "./default-layer-frame";

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

describe("presetForLayerFrame", () => {
  it("round-trips every one of the twenty-seven", () => {
    for (const position of LAYER_FRAME_POSITIONS) {
      for (const size of LAYER_FRAME_SIZES) {
        const frame = layerFrameForChoice(position, size, 16 / 9);
        expect(presetForLayerFrame(frame, 16 / 9)).toEqual({ position, size });
      }
    }
  });

  it("says CUSTOM for a rectangle no preset produces", () => {
    // Not an error, and not "whichever is nearest" — it is what a hand-written
    // frame looks like, and what dragging an inset will produce.
    expect(presetForLayerFrame({ x: 0.123, y: 0.456, width: 0.321 }, 16 / 9)).toBeNull();
  });

  it("says custom for no frame at all", () => {
    expect(presetForLayerFrame(undefined, 16 / 9)).toBeNull();
  });

  it("is judged against the CLIP's aspect, not a fixed one", () => {
    // The same stored rectangle means a different preset for a differently
    // shaped clip, because `y` absorbs the height.
    const squarish = layerFrameForChoice("bottom-right", "medium", 4 / 3);
    expect(presetForLayerFrame(squarish, 4 / 3)).toEqual({
      position: "bottom-right",
      size: "medium",
    });
    expect(presetForLayerFrame(squarish, 16 / 9)).toBeNull();
  });

  it("collapses onto the FIRST match when a clip is too tall to move vertically", () => {
    // A clip tall enough to fill the frame's height leaves no room to move
    // vertically, so every vertical position clamps to the same rectangle and
    // top-right and bottom-right become the same picture. Reading order
    // decides, and the picker lights the top row. Not a defect: there is
    // genuinely nowhere else for that inset to sit.
    //
    // The aspect is pinned HERE rather than borrowed from the output format,
    // which changed under this test once already — at 16:9 a 9:16 clip no
    // longer quite fills the height, and the case silently stopped being the
    // one the name describes.
    const SLIVER = 1 / 4;
    const tall = layerFrameForChoice("bottom-right", "medium", SLIVER);
    expect(layerFrameForChoice("top-right", "medium", SLIVER)).toEqual(tall);
    expect(presetForLayerFrame(tall, SLIVER)?.position).toBe("top-right");
  });

  it("matches the default the write path stamps", () => {
    expect(presetForLayerFrame(defaultLayerFrame(16 / 9), 16 / 9)).toEqual({
      position: "bottom-right",
      size: "medium",
    });
  });
});
