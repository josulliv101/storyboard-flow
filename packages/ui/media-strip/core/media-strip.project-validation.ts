import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  isCollectionItem,
} from "./media-strip.types";

export type ProjectValidationResult =
  | Readonly<{ valid: true; orphanedCollectionIds: CollectionId[] }>
  | Readonly<{ valid: false; reason: "missing-collection"; collectionId: CollectionId; itemId?: TimelineItemId }>
  | Readonly<{ valid: false; reason: "collection-cycle"; cycle: CollectionId[] }>
  | Readonly<{ valid: false; reason: "duplicate-global-item-ids"; itemId: TimelineItemId }>
  | Readonly<{
    valid: false;
    reason: "multiple-parents";
    collectionId: CollectionId;
    parentCollectionIds: readonly [CollectionId, CollectionId];
  }>;

/**
 * Validates the graph structure of a project's timeline collections,
 * detecting missing references, cycles, duplicate IDs, and shared
 * (multi-parent) collections — across every collection in `collectionsById`,
 * not just the ones reachable from `rootCollectionIds`. Orphaned
 * (unreachable) collections still have their internal structure fully
 * validated in a second pass; only their *reachability* is reported
 * differently, via `orphanedCollectionIds`.
 *
 * Collections are modeled as a tree, not a DAG: each collection may be
 * referenced by at most one `CollectionTimelineItem` project-wide. This is
 * a deliberate choice, not just a validation nicety — `parentByCollectionId`
 * in media-strip-board.tsx (which drives ancestor-cycle checks during a
 * drag) is a single-valued map that already assumes a collection has at
 * most one parent. A collection shared by two parents would silently pick
 * whichever parent was registered last, rather than erroring, so this
 * check exists to catch the graph shape that map can't represent before it
 * causes that kind of silent misbehavior.
 */
export function validateProjectTimeline({
  collectionsById,
  rootCollectionIds,
  assumeGlobalItemIds = true,
}: {
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  rootCollectionIds: readonly CollectionId[];
  assumeGlobalItemIds?: boolean;
}): ProjectValidationResult {
  // `visited` gates re-exploration across both passes below (so no
  // collection is walked twice); `reachableFromRoot` is the narrower set
  // used only to compute `orphanedCollectionIds`, and is only ever
  // populated during the root pass.
  const visited = new Set<CollectionId>();
  const reachableFromRoot = new Set<CollectionId>();
  const path = new Set<CollectionId>();
  const allItemIds = new Set<TimelineItemId>();
  // Child collectionId -> the one collection allowed to claim it as a
  // child. Populated (and checked) every time a CollectionTimelineItem is
  // encountered, regardless of `visited` — the visited-gate below exists to
  // avoid re-walking a subtree's contents twice, but a second parent must
  // still be caught even if the child was already visited via the first one.
  const parentByChildCollectionId = new Map<CollectionId, CollectionId>();

  // Iterative DFS (explicit frame stack) rather than recursion: this walks
  // an externally-supplied graph, so a pathologically deep collection chain
  // must not blow the call stack. Each frame carries a cursor (`itemIndex`)
  // into its collection's items so a child is explored immediately when
  // reached and control resumes at the next sibling afterward — preserving
  // the exact item-order interleaving (and therefore which of several
  // possible errors is reported first) of the original recursion.
  type DfsFrame = { colId: CollectionId; col: TimelineCollection; itemIndex: number };
  const stack: DfsFrame[] = [];

  // Runs the entry checks for `colId` and, if it should be explored, pushes
  // a frame. Returns a cycle result to bubble up, or `null` to proceed
  // (whether it pushed a frame or skipped an already-visited/missing node).
  const enter = (colId: CollectionId, markReachable: boolean): ProjectValidationResult | null => {
    if (path.has(colId)) {
      // Append colId again so the reported cycle shows the edge that closes
      // the loop (e.g. [a, b, a]), not just the set of nodes involved.
      return { valid: false, reason: "collection-cycle", cycle: [...path, colId] };
    }
    if (visited.has(colId)) {
      if (markReachable) reachableFromRoot.add(colId);
      return null;
    }
    const col = collectionsById.get(colId);
    if (!col) return null;

    path.add(colId);
    visited.add(colId);
    if (markReachable) reachableFromRoot.add(colId);
    stack.push({ colId, col, itemIndex: 0 });
    return null;
  };

  const run = (startId: CollectionId, markReachable: boolean): ProjectValidationResult => {
    const cycleAtStart = enter(startId, markReachable);
    if (cycleAtStart) return cycleAtStart;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.itemIndex >= frame.col.items.length) {
        path.delete(frame.colId);
        stack.pop();
        continue;
      }

      const item = frame.col.items[frame.itemIndex++];

      if (assumeGlobalItemIds) {
        if (allItemIds.has(item.id)) {
          return { valid: false, reason: "duplicate-global-item-ids", itemId: item.id };
        }
        allItemIds.add(item.id);
      }

      if (isCollectionItem(item)) {
        const referencedCol = collectionsById.get(item.collectionId);
        if (!referencedCol) {
          return {
            valid: false,
            reason: "missing-collection",
            collectionId: item.collectionId,
            itemId: item.id,
          };
        }

        const existingParent = parentByChildCollectionId.get(item.collectionId);
        if (existingParent !== undefined && existingParent !== frame.colId) {
          return {
            valid: false,
            reason: "multiple-parents",
            collectionId: item.collectionId,
            parentCollectionIds: [existingParent, frame.colId],
          };
        }
        parentByChildCollectionId.set(item.collectionId, frame.colId);

        // Explore the child now; the next loop iteration picks up its frame
        // (depth-first), and this frame resumes at the next sibling once the
        // child subtree drains.
        const cycle = enter(item.collectionId, markReachable);
        if (cycle) return cycle;
      }
    }

    return { valid: true, orphanedCollectionIds: [] };
  };

  // Pass 1: walk from the declared roots. Anything visited here is reachable.
  for (const rootId of rootCollectionIds) {
    if (!collectionsById.has(rootId)) {
      return {
        valid: false,
        reason: "missing-collection",
        collectionId: rootId,
      };
    }
    const res = run(rootId, true);
    if (!res.valid) return res;
  }

  // Pass 2: validate every collection not reached from a root — dangling
  // references, cycles, and duplicate item IDs inside orphaned subgraphs
  // would otherwise never be checked. This never marks anything reachable,
  // so orphan status computed below is unaffected.
  for (const colId of collectionsById.keys()) {
    if (visited.has(colId)) continue;
    const res = run(colId, false);
    if (!res.valid) return res;
  }

  const orphanedCollectionIds: CollectionId[] = [];
  for (const colId of collectionsById.keys()) {
    if (!reachableFromRoot.has(colId)) {
      orphanedCollectionIds.push(colId);
    }
  }

  return { valid: true, orphanedCollectionIds };
}
