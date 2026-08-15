import type {
  CollectionsGraph,
  NodeId,
  SetNodePlacementCommand,
} from "@storyboard/ui/dnd-collections";

import { defaultLayerFrame, hasPicture } from "@/lib/default-layer-frame";

// The DRAG's half of default-inset stamping. The rule itself — which nodes get
// one and what it is — lives in `lib/default-layer-frame`, shared with the
// `set_lane` tool so the two authoring routes cannot diverge.
//
// This is wired through `mapPlacementCommand`, which exists because the
// rectangle depends on the clip's aspect and the project's output size. A
// generic collections engine knows neither and should not learn them.

/**
 * Add the default inset to a placement that is moving clips ONTO a lane.
 *
 * Left alone in every other case:
 *
 * - the placement already names a frame — the caller has decided;
 * - it is not moving onto a lane (`trackIndex` absent, null, or 0) — a drag
 *   ALONG a lane must not reset an inset the user adjusted, and a drop back
 *   onto the picture clears it in `resolvePlacementCommand` instead;
 * - nothing being placed has a picture — an all-audio drop stays sound;
 * - anything being placed ALREADY has a frame. One command carries one
 *   rectangle for N nodes, so there is no way to stamp the bare ones and leave
 *   the rest; leaving all of them is the predictable half of that choice, and
 *   it never overwrites a position somebody chose.
 *
 * The aspect comes from the first node with a picture, so a mixed multi-select
 * gets one shared rectangle — the same simplification the placement already
 * makes for `placedStart`, which puts every dragged clip at the same time.
 */
export function withDefaultLayerFrame(
  command: SetNodePlacementCommand,
  graph: CollectionsGraph,
  aspectOf: (nodeId: NodeId) => number | undefined,
): SetNodePlacementCommand {
  const { trackIndex, layerFrame } = command.placement;
  if (layerFrame !== undefined) return command;
  if (trackIndex === undefined || trackIndex === null || trackIndex === 0) return command;

  let sawPicture = false;
  let aspect: number | undefined;
  for (const nodeId of command.nodeIds) {
    const node = graph.nodesById.get(nodeId);
    if (!hasPicture(node)) continue;
    // Already positioned — see the note above about one rectangle for N nodes.
    if (node?.layerFrame !== undefined) return command;
    sawPicture = true;
    aspect ??= aspectOf(nodeId);
  }
  if (!sawPicture) return command;

  return {
    ...command,
    placement: { ...command.placement, layerFrame: defaultLayerFrame(aspect) },
  };
}
