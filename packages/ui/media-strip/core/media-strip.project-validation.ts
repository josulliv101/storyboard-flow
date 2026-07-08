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

  function dfs(colId: CollectionId, markReachable: boolean): ProjectValidationResult {
    if (path.has(colId)) {
      // Append colId again so the reported cycle shows the edge that closes
      // the loop (e.g. [a, b, a]), not just the set of nodes involved.
      return { valid: false, reason: "collection-cycle", cycle: [...path, colId] };
    }
    if (visited.has(colId)) {
      if (markReachable) reachableFromRoot.add(colId);
      return { valid: true, orphanedCollectionIds: [] };
    }

    const col = collectionsById.get(colId);
    if (!col) {
      return { valid: true, orphanedCollectionIds: [] };
    }

    path.add(colId);
    visited.add(colId);
    if (markReachable) reachableFromRoot.add(colId);

    for (const item of col.items) {
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
        if (existingParent !== undefined && existingParent !== colId) {
          return {
            valid: false,
            reason: "multiple-parents",
            collectionId: item.collectionId,
            parentCollectionIds: [existingParent, colId],
          };
        }
        parentByChildCollectionId.set(item.collectionId, colId);

        const res = dfs(item.collectionId, markReachable);
        if (!res.valid) return res;
      }
    }

    path.delete(colId);
    return { valid: true, orphanedCollectionIds: [] };
  }

  // Pass 1: walk from the declared roots. Anything visited here is reachable.
  for (const rootId of rootCollectionIds) {
    if (!collectionsById.has(rootId)) {
      return {
        valid: false,
        reason: "missing-collection",
        collectionId: rootId,
      };
    }
    const res = dfs(rootId, true);
    if (!res.valid) return res;
  }

  // Pass 2: validate every collection not reached from a root — dangling
  // references, cycles, and duplicate item IDs inside orphaned subgraphs
  // would otherwise never be checked. This never marks anything reachable,
  // so orphan status computed below is unaffected.
  for (const colId of collectionsById.keys()) {
    if (visited.has(colId)) continue;
    const res = dfs(colId, false);
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
