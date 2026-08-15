import { durationToWidth, MIN_ITEM_WIDTH } from "@storyboard/ui/dnd-collections";
import type { CollectionsGraph } from "@storyboard/ui/dnd-collections";
import type { DetailsById, FlatItem } from "@storyboard/timeline-domain";
import type { TimelineClip } from "@storyboard/timeline-model/types";

import {
  childSpans,
  flatCardSpans,
  type ChildSpan,
  type LaneScope,
  type PreviewCardSpans,
} from "./graph-playhead-model";
import { TIMELINE_PPS } from "./graph-view-config";

// How WIDE a card is drawn, and WHICH cards a time overlay measures.
//
// Pure geometry, pulled out of graph-preview.tsx so it can be tested — this
// app's vitest cannot parse `.tsx`, so none of this was reachable by a unit
// test while it sat beside JSX. Its sibling `graph-playhead-model.ts` already
// holds the time↔x math for the same reason; this is the width half.
//
// The rule these serve: the strip's `itemWidth` prop and the playhead's width
// model must read the SAME number. If they ever disagree the marker drifts off
// the cards it is meant to point at.

/**
 * A collection card's width, scaled by the zoom slider like every media clip
 * beside it. Collections carry no single duration to lay out by, so they keep a
 * UNIFORM width — but that width now tracks pixels-per-second so a collection no
 * longer sits frozen while the clips around it grow and shrink. 128px at the
 * default scale (a ~3.2s-equivalent slot), floored so it stays clickable when
 * zoomed all the way out.
 *
 * Exported so the strip's `itemWidth` prop and the playhead's own width model
 * read the SAME number — the two must agree or the marker drifts off the cards.
 */
const COLLECTION_CARD_BASE_PX = 128;
/** Collections never render narrower than a 16:9 box against the card height
 *  they are drawn at. Zooming out used to squeeze them into slivers no one
 *  could read or hit; the aspect floor keeps the poster frame intact and
 *  scales with item size, so `xs` rows and `xl` rows each get a proportionate
 *  minimum instead of one flat pixel count. */
const COLLECTION_MIN_ASPECT = 16 / 9;
export function collectionCardWidth(pixelsPerSecond: number, cardHeight: number): number {
  return Math.max(
    MIN_ITEM_WIDTH,
    cardHeight * COLLECTION_MIN_ASPECT,
    COLLECTION_CARD_BASE_PX * (pixelsPerSecond / TIMELINE_PPS),
  );
}

/**
 * The strip's width resolution at a given zoom, injected into the pure
 * playhead model so its cards use EXACTLY the widths the strip renders —
 * collections at the shared per-zoom width (with its aspect floor), media by
 * duration. `cardHeight` is the strip's own `itemHeight`, which the floor
 * needs; pass 0 where widths are not read (see `cardsFor` callers).
 */
export function clipWidthAt(
  pixelsPerSecond: number,
  cardHeight: number,
): (clip: TimelineClip) => number {
  return (clip) =>
    clip.kind === "collection"
      ? collectionCardWidth(pixelsPerSecond, cardHeight)
      : durationToWidth(clip.duration, pixelsPerSecond);
}

/**
 * The cards a time overlay should measure: the flat run when one is showing,
 * this collection's own children otherwise. One resolution, called from every
 * overlay — including the ones that rebuild inside an effect rather than a
 * memo, which is why it is a plain function and not a hook.
 */
export function cardsFor(
  graph: CollectionsGraph,
  details: DetailsById,
  focusedId: string,
  spans: PreviewCardSpans | null,
  pixelsPerSecond: number,
  /** The strip's `itemHeight` — only the collection aspect floor reads it.
   *  Callers that consume times and counts rather than geometry pass 0. */
  cardHeight: number,
  flatItems: readonly FlatItem[] | null,
  /** Defaults to EVERY lane — see `childSpans`. Only an overlay measured
   *  against a strip that draws lanes as separate ROWS passes "picture". Flat
   *  mode is a single sequence either way. */
  laneScope: LaneScope = "all",
): ChildSpan[] {
  return flatItems
    ? flatCardSpans(graph, flatItems, focusedId, spans, (seconds) =>
        durationToWidth(seconds, pixelsPerSecond),
      )
    : childSpans(
        graph,
        details,
        focusedId,
        spans,
        clipWidthAt(pixelsPerSecond, cardHeight),
        laneScope,
      );
}
