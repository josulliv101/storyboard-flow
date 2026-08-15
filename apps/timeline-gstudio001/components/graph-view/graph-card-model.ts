/**
 * The card's pure DECISIONS — everything `graph-item-content` and the two card
 * components ask before they render a pixel.
 *
 * A `.ts` module for the reason `graph-playhead-model` beside it is one: the
 * app's vitest cannot parse `.tsx`, so a rule written inside a card component
 * is untestable by construction. Each function here was inline in
 * `graph-item-content.tsx` and had no coverage; extracting them is most of the
 * point of the split (#281).
 *
 * NO CLASS NAMES. Tailwind's content scan does cover `components`, so a class
 * written here WOULD be generated — but the two card kinds have to agree on
 * these mappings, and the way they drifted before was by each writing its own
 * literals. This module returns a STATE and the shared
 * `graph-card-dimming` module turns it into classes, so there is exactly one
 * chain and one place the classes live.
 */

import type { CollectionsGraph, NodeId } from "@storyboard/ui/dnd-collections";
import type { DisabledVisualState } from "@/lib/disabled-visuals";

/**
 * A collection's ENABLED child count.
 *
 * Enabled only, so the card agrees with the time totals beside it and with the
 * served summary (which derives `itemCount` from the effective document). The
 * primitive's own `childCount` counts every child, disabled included, which is
 * a different number and the wrong one for a readout.
 */
export function enabledChildCount(graph: CollectionsGraph, nodeId: NodeId): number {
  let total = 0;
  for (const child of graph.childrenById.get(nodeId) ?? []) {
    if (graph.nodesById.get(child)?.disabled !== true) total += 1;
  }
  return total;
}

/**
 * Whether this collection LEADS with audio.
 *
 * A collection's thumbnail is its first child's frame, and audio has no frame
 * — so a collection of voice takes fell through to the film-leader crosshair,
 * which says "no picture here" when the honest answer is "this is sound".
 *
 * FIRST child, not "any" and not "all": it mirrors exactly what the thumbnail
 * would otherwise have shown, so the glyph and the frame it replaces are
 * answering the same question. A collection whose first item is a video and
 * whose second is audio still shows the video's frame, which is correct.
 *
 * Disabled children are NOT skipped, deliberately — this asks what the
 * thumbnail slot would have drawn, and the preview walk that fills that slot
 * does not skip them either. Filtering here would put a glyph on a card whose
 * picture came from somewhere else.
 */
export function firstChildIsAudio(graph: CollectionsGraph, nodeId: NodeId): boolean {
  const first = graph.childrenById.get(nodeId)?.[0];
  if (first === undefined) return false;
  const node = graph.nodesById.get(first);
  return node?.kind === "media" && node.mediaKind === "audio";
}

/** How far a card is knocked back, and WHY — one name per cause, because each
 *  wears a different treatment. */
export type CardKnockBack = "none" | "drag-source" | "self" | "inherited" | "filter-miss";

export type CardDimming = Readonly<{
  knockBack: CardKnockBack;
  /** Desaturated as well as dimmed. Self-disabled only. */
  grayscale: boolean;
}>;

/**
 * The dimming PRECEDENCE, shared by both card kinds.
 *
 * It was written twice — once in the media card, once in the collection card —
 * as two matching ternary ladders, under a comment on each promising they were
 * "shared so the two kinds cannot drift apart". They were not shared; they were
 * copied, which is the state that drifts. One function now, and the card kinds
 * cannot disagree.
 *
 * The order is the argument:
 *
 *   DRAG SOURCE outranks everything. While a card is being dragged, "this is
 *   the thing in your hand" is the only fact that matters about it.
 *
 *   DISABLED outranks a filter miss. Off is a property of the item; a filter
 *   miss is a property of your current search. A card that is both should read
 *   as off, because that is the one that survives clearing the filter.
 *
 * GRAYSCALE is NOT part of the ladder — it tracks self-disabling alone, so a
 * self-disabled card being dragged is `drag-source` opacity AND grayscale.
 * That is deliberate and was the pre-split behaviour: the drag ghost is what
 * shows the card at full strength, and the source it left behind should still
 * look switched off.
 */
export function cardDimming(
  input: Readonly<{
    isDragSource: boolean;
    disabledVisuals: DisabledVisualState;
    filterMiss: boolean;
  }>,
): CardDimming {
  const grayscale = input.disabledVisuals === "self";
  if (input.isDragSource) return { knockBack: "drag-source", grayscale };
  if (input.disabledVisuals !== "none") {
    return { knockBack: input.disabledVisuals, grayscale };
  }
  if (input.filterMiss) return { knockBack: "filter-miss", grayscale };
  return { knockBack: "none", grayscale };
}

/**
 * How many frames a media card's filmstrip shows.
 *
 * In the GRID a video is ONE frame, full width — a thumbnail, the same shape an
 * image card has. The filmstrip is a STRIP idea and stays there: that surface
 * makes a card as wide as its clip is long, so extra width is extra time and a
 * sequence of frames is the honest thing to put in it. A grid cell's width is
 * just the cell's, so splitting it between frames showed two half-width
 * pictures to say nothing about duration.
 *
 * `settledFrames` is the measured count and is 0 until the card has been
 * measured once; `fallbackFrames` is the duration-based guess that covers that
 * first paint. Passed IN rather than computed here so this module needs no
 * import from the dnd package — it stays pure data in, number out.
 */
export function cardVideoFrameCount(
  input: Readonly<{
    isVideo: boolean;
    inGrid: boolean;
    settledFrames: number;
    fallbackFrames: number;
    cap: number;
  }>,
): number {
  if (!input.isVideo) return 1;
  if (input.inGrid) return 1;
  const wanted = input.settledFrames || input.fallbackFrames;
  return Math.max(1, Math.min(wanted, input.cap));
}

/**
 * The item count a COLLECTION card shows.
 *
 * Live children once hydrated; the stored summary until then. The fallback to
 * the live count when a placeholder carries no `itemCount` matters for a
 * collection created in this session, which has children but no served summary
 * yet — without it a brand-new collection reads "0 items" while showing its
 * clips.
 */
export function collectionCardItemCount(
  input: Readonly<{
    hydrated: boolean;
    enabledChildCount: number;
    storedItemCount: number | undefined;
  }>,
): number {
  if (input.hydrated) return input.enabledChildCount;
  return input.storedItemCount ?? input.enabledChildCount;
}

/**
 * The total duration a COLLECTION card shows, or null when it has none to show.
 *
 * PLAYABLE seconds both ways: live for a hydrated collection, and for a
 * placeholder the stored `playableDuration` summary — falling back to
 * `duration` for documents saved before the two were split, where they are
 * equal. Reaching for `duration` FIRST would silently report the layout span
 * (which includes disabled slots) as the thing a viewer sits through.
 */
export function collectionCardSeconds(
  input: Readonly<{
    hydrated: boolean;
    liveSeconds: number | null;
    storedPlayableDuration: number | undefined;
    storedDuration: number | undefined;
  }>,
): number | null {
  if (input.hydrated) return input.liveSeconds;
  return input.storedPlayableDuration ?? input.storedDuration ?? null;
}

/**
 * Which LANE a card's clip plays in, from its side-table entry.
 *
 * Defensive in the same way `trackIndexOf` in the model is, and for the same
 * reason: a detail entry can carry anything a stored document did, and a
 * fractional or negative index would put a chip on a card that packs as
 * picture. One answer to "which lane", on both sides of the seam.
 */
export function laneOf(detail: Readonly<{ trackIndex?: number }> | undefined): number {
  const track = detail?.trackIndex;
  return typeof track === "number" && Number.isInteger(track) && track >= 0 ? track : 0;
}
