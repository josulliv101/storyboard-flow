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
  | Readonly<{ valid: false; reason: "duplicate-global-item-ids"; itemId: TimelineItemId }>;

/**
 * Validates the reachable graph structure of a project's timeline collections,
 * detecting missing references, cycles, duplicate IDs, and identifying unreachable (orphaned) collections.
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
  const visited = new Set<CollectionId>();
  const path = new Set<CollectionId>();
  const allItemIds = new Set<TimelineItemId>();

  function dfs(colId: CollectionId): ProjectValidationResult {
    if (path.has(colId)) {
      return { valid: false, reason: "collection-cycle", cycle: Array.from(path) };
    }
    if (visited.has(colId)) {
      return { valid: true, orphanedCollectionIds: [] };
    }

    const col = collectionsById.get(colId);
    if (!col) {
      return { valid: true, orphanedCollectionIds: [] };
    }

    path.add(colId);
    visited.add(colId);

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
        const res = dfs(item.collectionId);
        if (!res.valid) return res;
      }
    }

    path.delete(colId);
    return { valid: true, orphanedCollectionIds: [] };
  }

  for (const rootId of rootCollectionIds) {
    if (!collectionsById.has(rootId)) {
      return {
        valid: false,
        reason: "missing-collection",
        collectionId: rootId,
      };
    }
    const res = dfs(rootId);
    if (!res.valid) return res;
  }

  const orphanedCollectionIds: CollectionId[] = [];
  for (const colId of collectionsById.keys()) {
    if (!visited.has(colId)) {
      orphanedCollectionIds.push(colId);
    }
  }

  return { valid: true, orphanedCollectionIds };
}
