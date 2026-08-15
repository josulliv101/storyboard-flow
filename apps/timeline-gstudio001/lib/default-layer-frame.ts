import {
  DEFAULT_LAYER_POSITION,
  DEFAULT_LAYER_SIZE,
  layerFrameForPreset,
  type LayerFrame,
} from "@storyboard/timeline-model/layer-frame";
import type { CollectionItemNode } from "@storyboard/ui/dnd-collections";

import { DEFAULT_RENDER_FORMAT } from "./render/cut-list";

// THE DEFAULT INSET a clip gets when it lands on a lane.
//
// Shared by the two authoring routes — the drag (`withDefaultLayerFrame`) and
// the `set_lane` tool — so that dragging a clip onto a lane and calling the
// tool produce the same thing. Splitting the rule would give one of them a
// visible layer and the other a silent one, which is the kind of difference
// nobody notices until a render comes out wrong.
//
// Why the write path stamps a default at all: a layered clip with no frame
// renders as SOUND ONLY, and that has to stay true so no stored document
// changes what it exports. But a clip dropped on a lane that shows nothing is
// the dead end the empty lane row fixed for lanes themselves — you make the
// gesture, nothing happens, you conclude it is broken. Stamping on the way in
// buys both.

/** The output frame's aspect. Fixed today; when export grows a settings
 *  surface this is the one place that has to start reading it. */
const FRAME_ASPECT = DEFAULT_RENDER_FORMAT.width / DEFAULT_RENDER_FORMAT.height;

/** What the details store falls back to for a clip with no recorded aspect. */
const FALLBACK_ASPECT = 16 / 9;

/**
 * Does this node have a picture to inset?
 *
 * A collection does — a whole nested scene under the picture is a legitimate
 * layer and composites like anything else. Audio does not, and putting a
 * rectangle on a voiceover would describe where something that can never draw
 * should be drawn.
 */
export function hasPicture(node: CollectionItemNode | undefined): boolean {
  if (node === undefined) return false;
  if (node.kind === "collection") return true;
  return node.mediaKind !== "audio";
}

/** The inset a clip gets when nobody has said where it should sit. */
export function defaultLayerFrame(aspect: number | undefined): LayerFrame {
  return layerFrameForPreset(
    DEFAULT_LAYER_POSITION,
    DEFAULT_LAYER_SIZE,
    aspect ?? FALLBACK_ASPECT,
    FRAME_ASPECT,
  );
}

/**
 * The `layerFrame` half of a placement that is moving ONE node onto a lane —
 * `{ layerFrame }` when it should get the default, `{}` when it should be left
 * exactly as it is.
 *
 * Left alone when the node has no picture (audio stays sound) or already has a
 * frame (moving between lanes must not throw away a position the user chose).
 */
export function defaultLayerFramePlacement(
  node: CollectionItemNode | undefined,
  detail: Readonly<{ aspect?: number }> | undefined,
): Readonly<{ layerFrame?: LayerFrame }> {
  if (!hasPicture(node) || node?.layerFrame !== undefined) return {};
  return { layerFrame: defaultLayerFrame(detail?.aspect) };
}
