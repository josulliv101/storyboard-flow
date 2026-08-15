import { describe, expect, it } from "vitest";

import {
  buildGraph,
  parseNodeId,
  type GraphNodeSpec,
  type NodeId,
  type SetNodePlacementCommand,
} from "@storyboard/collections-core";

import { defaultLayerFrame } from "@/lib/default-layer-frame";

import { withDefaultLayerFrame } from "./graph-layer-frame";

const SPECS: GraphNodeSpec[] = [
  { kind: "media", id: "img", name: "img" },
  { kind: "media", id: "img2", name: "img2" },
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

const GRAPH = (() => {
  const built = buildGraph([{ kind: "collection", id: "root", name: "Root", children: SPECS }]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
})();

const ASPECTS: Record<string, number> = { img: 16 / 9, img2: 16 / 9, vo: 16 / 9, framed: 16 / 9 };
const aspectOf = (nodeId: NodeId) => ASPECTS[nodeId as string];

const place = (
  ids: readonly string[],
  placement: SetNodePlacementCommand["placement"],
): SetNodePlacementCommand => ({
  type: "set-node-placement",
  nodeIds: ids.map(parseNodeId),
  placement,
});

const mapped = (command: SetNodePlacementCommand) =>
  withDefaultLayerFrame(command, GRAPH, aspectOf);

describe("withDefaultLayerFrame", () => {
  it("stamps the default when a picture clip moves onto a lane", () => {
    expect(mapped(place(["img"], { trackIndex: 1, placedStart: 2 })).placement).toEqual({
      trackIndex: 1,
      placedStart: 2,
      layerFrame: defaultLayerFrame(16 / 9),
    });
  });

  it("leaves a drag ALONG a lane alone, so an adjusted inset survives it", () => {
    // No `trackIndex` means the lane is not changing — only the time is.
    // Re-stamping here would drag a positioned inset back to the corner every
    // time the clip was nudged along its lane.
    const command = place(["img"], { placedStart: 4 });
    expect(mapped(command)).toBe(command);
  });

  it("leaves a move onto the PICTURE alone — that path clears the frame instead", () => {
    const command = place(["img"], { trackIndex: null, placedStart: null, layerFrame: null });
    expect(mapped(command)).toBe(command);
  });

  it("never overrides a frame the placement already names", () => {
    const chosen = { x: 0.02, y: 0.03, width: 0.5 };
    expect(mapped(place(["img"], { trackIndex: 1, layerFrame: chosen })).placement.layerFrame).toEqual(
      chosen,
    );
  });

  it("leaves AUDIO as sound", () => {
    const command = place(["vo"], { trackIndex: 1, placedStart: 0 });
    expect(mapped(command)).toBe(command);
  });

  it("leaves a clip that already has a frame alone", () => {
    const command = place(["framed"], { trackIndex: 2 });
    expect(mapped(command)).toBe(command);
  });

  it("stamps a mixed batch off the first clip WITH a picture", () => {
    // The audio in the batch cannot supply an aspect and must not veto the
    // stamp for the clips that can.
    expect(mapped(place(["vo", "img"], { trackIndex: 1 })).placement.layerFrame).toEqual(
      defaultLayerFrame(16 / 9),
    );
  });

  it("leaves the WHOLE batch alone when any member is already positioned", () => {
    // One command carries one rectangle for N nodes, so there is no way to
    // stamp the bare ones and leave the rest. Leaving all of them is the half
    // that never destroys a position somebody chose.
    const command = place(["img", "framed"], { trackIndex: 1 });
    expect(mapped(command)).toBe(command);
  });

  it("is a no-op for a node that is not in the graph", () => {
    const command = place(["ghost"], { trackIndex: 1 });
    expect(mapped(command)).toBe(command);
  });
});
