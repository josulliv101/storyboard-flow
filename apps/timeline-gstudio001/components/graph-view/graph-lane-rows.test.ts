import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";
import type { ClipDetail, DetailsById } from "@storyboard/timeline-domain";
import { CLIP_GAP_SECONDS } from "@storyboard/timeline-model/constants";

import { laneDropBoundary, laneDropIndex, splitLaneRows } from "./graph-lane-rows";

const media = (id: string, durationSeconds: number): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds,
});

const collection = (id: string, children: readonly GraphNodeSpec[] = []): GraphNodeSpec => ({
  kind: "collection",
  id,
  name: id,
  children,
});

function graphOf(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** A side-table entry with only the fields a test cares about set. */
const detail = (over: Partial<ClipDetail> = {}): ClipDetail => ({
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
  ...over,
});

/** A details side table putting the named nodes on a lane. */
function lanes(byId: Readonly<Record<string, number>>): DetailsById {
  const details: Record<string, ClipDetail> = {};
  for (const [id, trackIndex] of Object.entries(byId)) details[id] = detail({ trackIndex });
  return details;
}

describe("splitLaneRows", () => {
  it("puts everything on the picture when nothing has a lane", () => {
    const graph = graphOf([collection("scene", [media("a", 4), media("b", 4)])]);
    const model = splitLaneRows(graph, {} as DetailsById, "scene");

    expect(model.pictureIds).toEqual(["a", "b"]);
    expect(model.layers).toEqual([]);
    expect(model.pictureTimes).toEqual([
      { startSeconds: 0, durationSeconds: 4 },
      { startSeconds: 4 + CLIP_GAP_SECONDS, durationSeconds: 4 },
    ]);
  });

  it("is empty for a collection with no children", () => {
    const graph = graphOf([collection("scene", [])]);
    expect(splitLaneRows(graph, {} as DetailsById, "scene")).toEqual({
      pictureIds: [],
      pictureTimes: [],
      layers: [],
    });
  });

  it("pulls a lane-1 clip off the picture and onto its own row", () => {
    const graph = graphOf([
      collection("scene", [media("shot1", 4), media("bed", 12), media("shot2", 4)]),
    ]);
    const model = splitLaneRows(graph, lanes({ bed: 1 }), "scene");

    expect(model.pictureIds).toEqual(["shot1", "shot2"]);
    expect(model.layers).toHaveLength(1);
    expect(model.layers[0]?.lane).toBe(1);
    expect(model.layers[0]?.items).toEqual([
      { id: "bed", startSeconds: 0, durationSeconds: 12 },
    ]);
  });

  it("closes the gap the layered clip left in the picture", () => {
    // THE point of packing per lane: shot2 now follows shot1 directly instead
    // of starting after a 12s bed that no longer sits between them.
    const graph = graphOf([
      collection("scene", [media("shot1", 4), media("bed", 12), media("shot2", 4)]),
    ]);
    const model = splitLaneRows(graph, lanes({ bed: 1 }), "scene");

    expect(model.pictureTimes[1]?.startSeconds).toBe(4 + CLIP_GAP_SECONDS);
  });

  it("starts every lane at the same instant, so a bed runs UNDER the picture", () => {
    const graph = graphOf([
      collection("scene", [media("shot1", 4), media("shot2", 4), media("bed", 8)]),
    ]);
    const model = splitLaneRows(graph, lanes({ bed: 1 }), "scene");

    expect(model.pictureTimes[0]?.startSeconds).toBe(0);
    expect(model.layers[0]?.items[0]?.startSeconds).toBe(0);
  });

  it("packs several cards on one lane in their own sequence", () => {
    const graph = graphOf([
      collection("scene", [media("shot", 20), media("vo1", 3), media("vo2", 3)]),
    ]);
    const model = splitLaneRows(graph, lanes({ vo1: 1, vo2: 1 }), "scene");

    expect(model.layers[0]?.items).toEqual([
      { id: "vo1", startSeconds: 0, durationSeconds: 3 },
      { id: "vo2", startSeconds: 3 + CLIP_GAP_SECONDS, durationSeconds: 3 },
    ]);
  });

  it("carries a PLACED start onto the row, lining up with nothing", () => {
    // #400. The board's geometry already accepted an arbitrary start; this is
    // the seam that finally supplies one — a voiceover at 7.5s with nothing
    // 7.5s long in front of it.
    const graph = graphOf([collection("scene", [media("shot", 30), media("vo", 2)])]);
    const details: DetailsById = { vo: detail({ trackIndex: 1, placedStart: 7.5 }) };
    const model = splitLaneRows(graph, details, "scene");

    expect(model.layers[0]?.items).toEqual([
      { id: "vo", startSeconds: 7.5, durationSeconds: 2 },
    ]);
    // The picture is untouched by a placement on a lane.
    expect(model.pictureTimes[0]?.startSeconds).toBe(0);
  });

  it("queues an unplaced clip behind a placed one on the same lane", () => {
    const graph = graphOf([
      collection("scene", [media("shot", 30), media("vo", 2), media("tail", 2)]),
    ]);
    const details: DetailsById = {
      vo: detail({ trackIndex: 1, placedStart: 7.5 }),
      tail: detail({ trackIndex: 1 }),
    };
    const model = splitLaneRows(graph, details, "scene");

    expect(model.layers[0]?.items.map((item) => item.startSeconds)).toEqual([
      7.5,
      9.5 + CLIP_GAP_SECONDS,
    ]);
  });

  it("gives each occupied lane its own row, in ascending order", () => {
    const graph = graphOf([
      collection("scene", [media("shot", 10), media("music", 10), media("vo", 4)]),
    ]);
    const model = splitLaneRows(graph, lanes({ vo: 2, music: 1 }), "scene");

    expect(model.layers.map((layer) => layer.lane)).toEqual([1, 2]);
    expect(model.layers[0]?.items[0]?.id).toBe("music");
    expect(model.layers[1]?.items[0]?.id).toBe("vo");
  });

  it("skips unoccupied lanes rather than reserving a row for each", () => {
    // set_lane accepts any non-negative integer; reserving would draw fifty
    // rows for one clip. The chip still names the real lane.
    const graph = graphOf([collection("scene", [media("shot", 10), media("bed", 10)])]);
    const model = splitLaneRows(graph, lanes({ bed: 50 }), "scene");

    expect(model.layers).toHaveLength(1);
    expect(model.layers[0]?.lane).toBe(50);
  });

  it("treats a fractional or negative lane as the picture", () => {
    const graph = graphOf([
      collection("scene", [media("a", 4), media("b", 4), media("c", 4)]),
    ]);
    const model = splitLaneRows(graph, lanes({ b: 1.5, c: -1 }), "scene");

    expect(model.pictureIds).toEqual(["a", "b", "c"]);
    expect(model.layers).toEqual([]);
  });

  it("carries a hydrated collection child's whole span onto the row model", () => {
    const graph = graphOf([
      collection("scene", [
        collection("inner", [media("x", 5), media("y", 5)]),
        media("bed", 20),
      ]),
    ]);
    // `hydrated` is what makes a collection derive its span from live
    // children rather than the stored summary — the board's normal state
    // once a collection's contents have arrived.
    const details: DetailsById = {
      inner: detail({ hydrated: true }),
      bed: detail({ trackIndex: 1 }),
    };
    const model = splitLaneRows(graph, details, "scene");

    expect(model.pictureIds).toEqual(["inner"]);
    // A collection card is a fixed WIDTH holding an arbitrary span; the row
    // model reports the span, and the lane map stretches the card across it.
    expect(model.pictureTimes[0]?.durationSeconds).toBeGreaterThan(10);
  });
});

describe("laneDropBoundary", () => {
  // Document order: shot1, bed(lane 1), shot2, shot3.
  const siblings = ["shot1", "bed", "shot2", "shot3"];
  const pictureIds = ["shot1", "shot2", "shot3"];

  it("maps the strip's boundary onto the card it sits before", () => {
    expect(laneDropBoundary(pictureIds, siblings, 0)).toBe(0);
    // THE bug this exists for: lane-0 boundary 1 is "before shot2", which is
    // index 2 in the real list — reading it as 1 would insert before the bed.
    expect(laneDropBoundary(pictureIds, siblings, 1)).toBe(2);
    expect(laneDropBoundary(pictureIds, siblings, 2)).toBe(3);
  });

  it("appends past the last picture card", () => {
    expect(laneDropBoundary(pictureIds, siblings, 3)).toBe(4);
    expect(laneDropBoundary(pictureIds, siblings, 99)).toBe(4);
  });

  it("clamps a negative boundary to the start", () => {
    expect(laneDropBoundary(pictureIds, siblings, -3)).toBe(0);
  });

  it("appends rather than guessing when the lists disagree", () => {
    expect(laneDropBoundary(["gone"], siblings, 0)).toBe(4);
    expect(laneDropBoundary(pictureIds, siblings, 1.5)).toBe(4);
  });

  it("is the identity on a board with no layers", () => {
    const plain = ["a", "b", "c"];
    expect(plain.map((_, k) => laneDropBoundary(plain, plain, k))).toEqual([0, 1, 2]);
    expect(laneDropBoundary(plain, plain, 3)).toBe(3);
  });
});

describe("laneDropIndex", () => {
  const siblings = ["shot1", "bed", "shot2", "shot3"];
  const pictureIds = ["shot1", "shot2", "shot3"];

  it("subtracts dragged nodes already before the boundary", () => {
    // Dragging shot1 to sit before shot3: the translated boundary is 3, and
    // shot1 leaves a hole behind it, so the post-removal index is 2.
    expect(laneDropIndex(pictureIds, siblings, 2, ["shot1"])).toBe(2);
  });

  it("leaves a boundary before every dragged node alone", () => {
    expect(laneDropIndex(pictureIds, siblings, 0, ["shot3"])).toBe(0);
  });

  it("counts a dragged LAYER card sitting before the boundary", () => {
    // The bed is at index 1, before the translated boundary 3.
    expect(laneDropIndex(pictureIds, siblings, 2, ["bed"])).toBe(2);
  });

  it("adds with no drag set at the translated boundary", () => {
    expect(laneDropIndex(pictureIds, siblings, 1, [])).toBe(2);
  });
});
