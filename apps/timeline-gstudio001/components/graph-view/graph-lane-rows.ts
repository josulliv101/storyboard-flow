import { getChildren, parseNodeId, type CollectionsGraph } from "@storyboard/collections-core";
import { graphChildrenToClips, type DetailsById } from "@storyboard/timeline-domain";
import { trackIndexOf } from "@storyboard/timeline-model/documents";

import { LANE_TRACKS_ENABLED } from "@/lib/lane-tracks-flag";

// Splitting a collection's children into the PICTURE and the lanes that run
// under it — the read model behind the board's lane rows.
//
// Pure and framework-free (and a .ts, not a .tsx) so the app's vitest can
// parse it: the arithmetic here decides where a bed is drawn AND where a drop
// lands, and both need to be testable without a board.

/** A slot on the timeline clock — the shape `VirtualStrip` wants for its
 *  `itemTimes` and layer items. Structural, so this module owes the UI
 *  package no import. */
export type LaneTimedSlot = Readonly<{
  startSeconds: number;
  durationSeconds: number;
}>;

export type LaneCard = LaneTimedSlot & Readonly<{ id: string }>;

export type LaneRowsModel = Readonly<{
  /** Lane-0 child ids in document order — what the strip virtualizes. */
  pictureIds: readonly string[];
  /** Their times, aligned 1:1 with `pictureIds`. */
  pictureTimes: readonly LaneTimedSlot[];
  /**
   * One row per OCCUPIED lane, ascending. Empty lanes are skipped rather than
   * reserved: `set_lane` accepts any non-negative integer, so reserving them
   * would let a single clip on lane 50 draw fifty rows. The lane a card is
   * actually on stays legible through its `LaneChip`, which names the number.
   */
  layers: readonly Readonly<{ lane: number; items: readonly LaneCard[] }>[];
}>;

const EMPTY: LaneRowsModel = { pictureIds: [], pictureTimes: [], layers: [] };

/**
 * Split `collectionId`'s children by lane, with each card's time window.
 *
 * Times come from `graphChildrenToClips` — the same projection the playhead,
 * ruler and export read — so the row a bed draws on and the clock the player
 * runs cannot disagree. It packs PER LANE, which is what makes a lane-1 start
 * time mean "alongside the picture" rather than "after it".
 *
 * Zipped by INDEX against `getChildren`: `graphChildrenToClips` maps over that
 * same array, and a projection clip reports `detail.sourceClipId` rather than
 * the node id, so matching on id would drop exactly those cards.
 */
export function splitLaneRows(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: string,
  /**
   * Whether lanes are drawn at all. Defaults to the flag, so callers get the
   * shipped answer without knowing there is one — but it is a PARAMETER
   * because this module's whole claim is that it can be tested without a
   * board, and a module that reads `process.env` for its main decision cannot
   * be. The tests below drive both answers explicitly.
   */
  lanesEnabled: boolean = LANE_TRACKS_ENABLED,
): LaneRowsModel {
  const childIds = getChildren(graph, parseNodeId(collectionId));
  if (childIds.length === 0) return EMPTY;

  const clips = graphChildrenToClips(graph, details, collectionId);
  const pictureIds: string[] = [];
  const pictureTimes: LaneTimedSlot[] = [];
  const byLane = new Map<number, LaneCard[]>();

  childIds.forEach((childId, index) => {
    const clip = clips[index];
    if (clip === undefined) return;
    const slot: LaneTimedSlot = {
      startSeconds: clip.startTime,
      durationSeconds: clip.duration,
    };
    // FLAGGED OFF MEANS EVERY CLIP IS PICTURE, not "lane clips are hidden".
    // The rows are what the flag turns off; the clips in them are stored data
    // and still have to be drawn somewhere. Reading every lane as 0 puts them
    // in the picture row with everything else — the board a project had before
    // lanes existed — rather than leaving a stored clip that counts toward the
    // duration and composites into a render with nowhere on screen to be.
    //
    // Done HERE, at the split, because everything downstream of this function
    // — the drop-boundary correction, the strip's item times, the layer rows —
    // derives from what it returns. One `layers: []` at the source is the
    // whole feature off; gating each consumer would be four chances to leave
    // one on.
    const lane = lanesEnabled ? trackIndexOf(clip) : 0;
    if (lane === 0) {
      pictureIds.push(childId as string);
      pictureTimes.push(slot);
      return;
    }
    const row = byLane.get(lane);
    const card: LaneCard = { id: childId as string, ...slot };
    if (row) row.push(card);
    else byLane.set(lane, [card]);
  });

  const layers = [...byLane.keys()]
    .sort((a, b) => a - b)
    .map((lane) => ({ lane, items: byLane.get(lane) ?? [] }));

  return { pictureIds, pictureTimes, layers };
}

/**
 * Translate a boundary the STRIP published into one the graph understands.
 *
 * The strip is handed lane-0 children only, so the boundary it reports counts
 * lane-0 cards — while `resolveCommandFromIntent` reads it as an index into
 * the collection's FULL child list. On any board with a layer those two
 * disagree, and a drop lands somewhere nobody chose. This is the correction,
 * applied through `mapDropCommand` (the same seam flat mode uses).
 *
 * Boundary k means "immediately before the k-th lane-0 card", which is that
 * card's own position in the full list; past the last one means the very end.
 * Any layer cards that end up on the far side of the insert are unaffected —
 * lanes pack independently, so only the relative order WITHIN a lane matters,
 * and this preserves it for both.
 */
export function laneDropBoundary(
  pictureIds: readonly string[],
  siblings: readonly string[],
  boundary: number,
): number {
  if (!Number.isInteger(boundary)) return siblings.length;
  const clamped = Math.max(0, Math.min(boundary, pictureIds.length));
  if (clamped >= pictureIds.length) return siblings.length;
  const nextId = pictureIds[clamped];
  const index = nextId === undefined ? -1 : siblings.indexOf(nextId);
  // A lane-0 id the child list does not contain means the two were derived
  // from different graphs; appending is the honest answer, not a guess at a
  // position in a list this boundary was never measured against.
  return index === -1 ? siblings.length : index;
}

/**
 * The post-removal `toIndex` for a lane-aware drop — the boundary above, less
 * the dragged nodes already sitting before it.
 *
 * Mirrors `resolveCommandFromIntent`'s own convention deliberately: that is
 * the arithmetic being corrected, and re-deriving it from the translated
 * boundary is what makes the correction complete rather than an offset patch
 * on a number that was computed against the wrong list.
 */
export function laneDropIndex(
  pictureIds: readonly string[],
  siblings: readonly string[],
  boundary: number,
  draggedIds: readonly string[],
): number {
  const translated = laneDropBoundary(pictureIds, siblings, boundary);
  if (draggedIds.length === 0) return translated;
  const dragged = new Set(draggedIds);
  const draggedBefore = siblings
    .slice(0, translated)
    .filter((siblingId) => dragged.has(siblingId)).length;
  return translated - draggedBefore;
}
