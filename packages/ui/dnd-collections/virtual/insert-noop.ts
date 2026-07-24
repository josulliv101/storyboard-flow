import { type NodeId } from "../core/graph";

/**
 * True when a live insert-at-index into a collection would drop a CONTIGUOUS
 * run of the dragged items exactly where they already sit — an identity move,
 * so the drop indicator should hide. Dropping at any boundary from the run's
 * start to just past its end is a no-op; a non-contiguous multi-drag reorders
 * the items between them, so it is a real move and keeps its indicator. A
 * dragged item not in this collection makes it a real move IN.
 *
 * `O(active)`, no allocation or spread: positions come from the collection's
 * precomputed `childIndexById` map (both virtual views already build one), so
 * this stays cheap on the drag hot path even for thousands of children and a
 * large selection. It replaces `active.map((id) => children.indexOf(id))` plus
 * `Math.min(...positions)` / `Math.max(...positions)`, which ran every
 * drop-intent tick at `O(active × children)` and risked a spread `RangeError`
 * for a pathologically large selection.
 */
export function isContiguousReorderNoOp(
  childIndexById: ReadonlyMap<NodeId, number>,
  activeIds: readonly NodeId[],
  intentIndex: number,
): boolean {
  if (activeIds.length === 0) return false;

  let lo = Infinity;
  let hi = -Infinity;
  for (const id of activeIds) {
    const position = childIndexById.get(id);
    if (position === undefined) return false; // a dragged item lives elsewhere
    if (position < lo) lo = position;
    if (position > hi) hi = position;
  }

  const contiguous = hi - lo + 1 === activeIds.length;
  return contiguous && intentIndex >= lo && intentIndex <= hi + 1;
}
