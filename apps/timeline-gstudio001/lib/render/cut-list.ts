// PlaybackManifest -> RenderCutList. The whole of export's timeline
// arithmetic, in one pure function so it unit-tests without a renderer.
//
// The manifest already did the hard part: it flattens the COMPLETE nested
// document closure into absolute-time leaves, resolving trim and time-scaling
// at every level, so a leaf knows both where it plays and what it plays. This
// turns that PLAYBACK read model into an OUTPUT one, and the two differ in
// exactly two ways — both of which are decisions, not details.

import type { PlaybackLeaf, PlaybackManifest } from "@storyboard/timeline-domain";

import type { RenderCut, RenderCutList, RenderFormat } from "./types";

/**
 * What the 35s cuts use today, and the default until export grows a settings
 * surface. Deliberately a constant with a name rather than a literal at the
 * call site: the first thing anyone will want to change is the size, and the
 * second is to know what it was when a given file was made.
 */
export const DEFAULT_RENDER_FORMAT: RenderFormat = {
  width: 1152,
  height: 480,
  fps: 24,
};

/** Below this, a cut cannot survive rounding to a frame boundary and is more
 *  likely a packing artefact than an intended shot. */
const MIN_CUT_SECONDS = 1 / 1000;

/**
 * Compile the playback manifest into a render cut list.
 *
 * TWO differences from playback, and they are the point of this function:
 *
 * DISABLED LEAVES ARE DROPPED. The manifest compiles them IN, marked, and
 * deliberately keeps their span — that is right for playback, where the
 * playhead has to jump the span and a scrub has to be able to land inside it.
 * A finished file has no playhead. Dropping them is not enough on its own:
 * the span has to close too, or the export gets silence and black where the
 * disabled clip was, which is the same bug as the gaps below.
 *
 * GAPS ARE CLOSED. `CLIP_GAP_SECONDS` (0.12) is baked into every stored
 * `startTime` — it is a layout affordance so cards on the board do not touch.
 * Honouring `timelineStart` literally would emit 0.12s of black between every
 * clip: 2.28s across a 20-clip timeline, and a visible stutter at every join.
 * So the cuts are re-laid back to back and `outputStart` is the running total.
 *
 * Both fall out of the same rule: **the output is the enabled leaves, in
 * order, touching.** Which is why this is one pass and not two passes with a
 * repair between them.
 *
 * Order comes from `timelineStart`, not from array position. The manifest
 * emits leaves in document order today, so the sort is a no-op — but "output
 * order is time order" is the property that matters, and depending on the
 * compiler's traversal to supply it would be depending on something nobody
 * has promised.
 */
export function compileCutList(
  manifest: PlaybackManifest,
  format: RenderFormat = DEFAULT_RENDER_FORMAT,
): RenderCutList {
  const playable = manifest.leaves
    .filter((leaf) => leaf.disabled !== true)
    .filter((leaf) => leaf.timelineDuration >= MIN_CUT_SECONDS)
    .slice()
    .sort((a, b) => a.timelineStart - b.timelineStart);

  // Lane 0 is the picture; everything above it runs underneath. The manifest
  // has already resolved which is which, including for nested collections.
  const picture = playable.filter((leaf) => leaf.trackIndex === 0);
  const under = playable.filter((leaf) => leaf.trackIndex !== 0);

  let outputStart = 0;
  const cuts: RenderCut[] = picture.map((leaf) => {
    const cut = cutFromLeaf(leaf, outputStart);
    outputStart += cut.outputDuration;
    return cut;
  });

  const toOutputTime = boardToOutputTime(picture, outputStart);
  const layers: RenderCut[] = under.flatMap((leaf) => {
    const start = toOutputTime(leaf.timelineStart);
    // Past the end of the picture entirely: it would play over nothing. A
    // layer is defined by what it runs UNDER, so with no picture left there is
    // nothing for it to be under.
    if (start >= outputStart) return [];
    const cut = cutFromLeaf(leaf, start);
    // Clipped to the picture, for the same reason the output length is the
    // picture's: a bed does not extend the film past its last frame.
    const outputDuration = Math.min(cut.outputDuration, outputStart - start);
    return outputDuration < MIN_CUT_SECONDS ? [] : [{ ...cut, outputDuration }];
  });

  return { cuts, layers, durationSeconds: outputStart, format };
}

/**
 * Board time → output time, along the picture.
 *
 * Needed because closing the gaps MOVES everything. A bed that starts eight
 * seconds into the board does not start eight seconds into the film: the
 * picture before it has lost 0.12s per join and every disabled clip it
 * contained, so the same instant of picture now arrives earlier. Positioning a
 * layer by its board time would drift it later and later against the cut it
 * was lined up with — by a second across twenty joins, which is a VO landing
 * on the wrong shot.
 *
 * The map is piecewise-linear over the picture's cuts: inside a cut, offset
 * from that cut's own output start; in the gap between two, the next cut's
 * start, since the gap does not exist in the output; past the end, the end.
 */
function boardToOutputTime(
  picture: readonly PlaybackLeaf[],
  totalOutput: number,
): (boardTime: number) => number {
  // Built once and closed over: a layer list is short, but this is O(picture)
  // per lookup otherwise and the picture is not.
  const spans = picture.map((leaf, index) => ({
    boardStart: leaf.timelineStart,
    boardEnd: leaf.timelineStart + leaf.timelineDuration,
    outputStart: picture
      .slice(0, index)
      .reduce((total, earlier) => total + earlier.timelineDuration, 0),
  }));

  return (boardTime: number) => {
    if (spans.length === 0) return 0;
    for (const span of spans) {
      if (boardTime < span.boardStart) return span.outputStart;
      if (boardTime < span.boardEnd) {
        return span.outputStart + (boardTime - span.boardStart);
      }
    }
    return totalOutput;
  };
}

function cutFromLeaf(leaf: PlaybackLeaf, outputStart: number): RenderCut {
  return {
    src: leaf.src,
    kind: leaf.kind,
    // An image has no source timeline to seek into; the manifest still
    // reports 0, and normalising here keeps the worker from having to know
    // which kinds can be sought.
    sourceStart: leaf.kind === "image" ? 0 : leaf.sourceStart,
    outputDuration: leaf.timelineDuration,
    // Likewise: an image cannot play at a rate. Reported as 1 rather than
    // omitted so every cut has one shape.
    playbackRate: leaf.kind === "image" ? 1 : leaf.playbackRate,
    outputStart,
    // COMPOSITING FACTS, and only when there is something to composite. Both
    // are dropped for lane 0 and for an unframed layer, so `layers.some(has a
    // frame)` stays an honest test of "does this render need a re-encode".
    //
    // Audio can carry a frame in a stored document (nothing stops a writer),
    // and it must not reach the overlay: a normalised audio segment has a
    // SYNTHESISED BLACK video stream, so compositing one paints a black
    // rectangle over the picture for the length of the voiceover.
    ...(leaf.trackIndex !== 0 && leaf.layerFrame !== undefined && leaf.kind !== "audio"
      ? {
          trackIndex: leaf.trackIndex,
          layerFrame: leaf.layerFrame,
          aspect: leaf.aspect !== undefined && leaf.aspect > 0 ? leaf.aspect : 16 / 9,
        }
      : {}),
  };
}
