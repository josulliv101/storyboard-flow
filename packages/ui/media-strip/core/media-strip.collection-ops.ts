import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItem,
  type TimelineItemCommand,
  isCollectionItem,
} from "./media-strip.types";
import { wouldCreateCollectionCycle } from "./media-strip.validation";

/**
 * Synchronizes the derived count of nested items in a collection to prevent
 * timing/count drift. (One-level deep synchronization.)
 *
 * Allocation-free on the no-change path, which is the common case: a plain
 * reorder within a collection doesn't change any collection's item *count*,
 * so this runs on every `applyTimelineItemCommand` but usually has nothing
 * to do. Only a collection whose items actually changed gets a cloned array,
 * and the result map is only allocated if at least one collection changed —
 * otherwise the original `collectionsById` is returned untouched.
 */
export function syncCollectionItemCounts(
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>
): ReadonlyMap<CollectionId, TimelineCollection> {
  let result: Map<CollectionId, TimelineCollection> | null = null;

  for (const [colId, col] of collectionsById.entries()) {
    let nextItems: TimelineItem[] | null = null;

    for (let i = 0; i < col.items.length; i++) {
      const item = col.items[i];
      if (!isCollectionItem(item)) continue;

      const backingCol = collectionsById.get(item.collectionId);
      // No backing collection loaded yet: leave itemCount as-is. It's
      // documented as a *fallback* for exactly this case (see
      // CollectionTimelineItem.itemCount) — overwriting it with 0 here
      // would destroy the last-known count the moment a lazily-loaded
      // collection goes out of scope, instead of preserving it until the
      // real data is available to derive from.
      if (!backingCol) continue;

      const derivedCount = backingCol.items.length;
      if (item.itemCount === derivedCount) continue;

      // First changed item in this collection: clone its items array lazily.
      if (!nextItems) nextItems = [...col.items];
      nextItems[i] = { ...item, itemCount: derivedCount };
    }

    if (nextItems) {
      if (!result) result = new Map(collectionsById);
      result.set(colId, { ...col, items: nextItems });
    }
  }

  return result ?? collectionsById;
}

/**
 * Result of applying a `TimelineItemCommand`. Mirrors the `ok`/`reason`
 * shape `resolveTimelineCommandFromDrag` already returns, so a caller
 * doesn't need a different pattern to tell "nothing happened because the
 * command was invalid" apart from "nothing happened because it was already
 * a no-op" — both are explicit failure reasons here, not a silently
 * returned, unchanged map.
 */
export type ApplyTimelineItemCommandResult =
  | Readonly<{ ok: true; collectionsById: ReadonlyMap<CollectionId, TimelineCollection> }>
  | Readonly<{
    ok: false;
    reason: "missing-source" | "missing-target" | "cycle" | "same-position";
  }>;

/**
 * Pure reducer function to apply a TimelineItemCommand to the collections registry state.
 */
export function applyTimelineItemCommand({
  collectionsById,
  command,
}: {
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  command: TimelineItemCommand;
}): ApplyTimelineItemCommandResult {
  const { itemId, fromCollectionId } = command;

  const fromCol = collectionsById.get(fromCollectionId);
  if (!fromCol) return { ok: false, reason: "missing-source" };

  if (command.type === "move") {
    const { toCollectionId, toIndex } = command;
    const toCol = collectionsById.get(toCollectionId);
    if (!toCol) return { ok: false, reason: "missing-target" };

    if (fromCollectionId !== toCollectionId) {
      const item = fromCol.items.find((i) => i.id === itemId);
      if (item && isCollectionItem(item)) {
        if (
          wouldCreateCollectionCycle({
            movingCollectionId: item.collectionId,
            targetCollectionId: toCollectionId,
            collectionsById,
          })
        ) {
          return { ok: false, reason: "cycle" };
        }
      }
    }

    const nextCollections = new Map(collectionsById);

    if (fromCollectionId === toCollectionId) {
      const items = [...fromCol.items];
      const actualFromIndex = items.findIndex((i) => i.id === itemId);
      if (actualFromIndex === -1) return { ok: false, reason: "missing-source" };

      const [removed] = items.splice(actualFromIndex, 1);
      // TimelineItemCommand.toIndex is the desired final index after removal.
      const targetIdx = Math.max(0, Math.min(toIndex, items.length));
      if (actualFromIndex === targetIdx) return { ok: false, reason: "same-position" };
      items.splice(targetIdx, 0, removed);

      nextCollections.set(fromCollectionId, {
        ...fromCol,
        items,
      });
    } else {
      const fromItems = [...fromCol.items];
      const actualFromIndex = fromItems.findIndex((i) => i.id === itemId);
      if (actualFromIndex === -1) return { ok: false, reason: "missing-source" };
      const [removed] = fromItems.splice(actualFromIndex, 1);

      const toItems = [...toCol.items];
      const targetIdx = Math.max(0, Math.min(toIndex, toItems.length));
      toItems.splice(targetIdx, 0, removed);

      nextCollections.set(fromCollectionId, {
        ...fromCol,
        items: fromItems,
      });
      nextCollections.set(toCollectionId, {
        ...toCol,
        items: toItems,
      });
    }

    return { ok: true, collectionsById: syncCollectionItemCounts(nextCollections) };
  } else {
    // type === "nest"
    const { targetCollectionId, toIndex } = command;
    const targetCol = collectionsById.get(targetCollectionId);
    if (!targetCol) return { ok: false, reason: "missing-target" };

    const targetIdx = toIndex ?? targetCol.items.length;
    return applyTimelineItemCommand({
      collectionsById,
      command: {
        type: "move",
        itemId,
        fromCollectionId,
        toCollectionId: targetCollectionId,
        toIndex: targetIdx,
      },
    });
  }
}
