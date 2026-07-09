import {
  type CollectionId,
  type CollectionTimelineItem,
  type KeyboardReorderAction,
  type TimelineCollection,
  type TimelineItem,
  type TimelineItemCommand,
  type TimelineItemId,
  assertNever,
  isCollectionItem,
} from "./media-strip.types";
import { wouldCreateCollectionCycle } from "./media-strip.validation";

/**
 * Keys the reorder handle intercepts (preventDefault + stopPropagation),
 * given whether a keyboard reorder session is currently active. Arrows are
 * blocked even when idle so a stray arrow press on the handle doesn't
 * trigger the ToggleGroup's roving focus navigation, and Enter/Space are
 * blocked so they pick up/drop instead of firing the button's default
 * action. Home/End/N/U/Escape are only meaningful mid-session, so when idle
 * they keep their defaults (e.g. page scroll).
 */
export const IDLE_INTERCEPTED_KEYS: readonly string[] = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Enter",
  " ",
];

export const SESSION_INTERCEPTED_KEYS: readonly string[] = [
  ...IDLE_INTERCEPTED_KEYS,
  "Home",
  "End",
  "Escape",
  "n",
  "N",
  "u",
  "U",
];

/**
 * Pure `event.key` -> `KeyboardReorderAction` mapping for an active
 * keyboard reorder session. Returns `null` when idle (nothing to map to —
 * starting a session isn't itself a `KeyboardReorderAction`) or for keys
 * with no session meaning. Split out of use-reorder-keyboard.ts so this
 * mapping is directly unit-testable without React or a DOM event.
 */
export function getKeyboardReorderAction(
  key: string,
  isKeyboardReordering: boolean
): KeyboardReorderAction | null {
  if (!isKeyboardReordering) return null;

  switch (key) {
    case "ArrowLeft":
      return "move-left";
    case "ArrowRight":
      return "move-right";
    case "ArrowUp":
      return "move-up";
    case "ArrowDown":
      return "move-down";
    case "Home":
      return "move-home";
    case "End":
      return "move-end";
    case "Escape":
      return "cancel";
    case "Enter":
    case " ":
      return "confirm";
    default: {
      const lower = key.toLowerCase();
      if (lower === "n") return "nest";
      if (lower === "u") return "move-to-parent";
      return null;
    }
  }
}

type ItemLookup = ReadonlyMap<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;

/**
 * Every `KeyboardReorderAction` except "confirm" and "cancel" — those two
 * are genuine session-lifecycle transitions (they read/write the active
 * session's remembered start position), not command resolution, so
 * `use-keyboard-reorder-session.ts` still handles them directly.
 */
export type ResolvableKeyboardReorderAction = Exclude<KeyboardReorderAction, "confirm" | "cancel">;

export type KeyboardReorderResolution =
  | Readonly<{ kind: "move"; command: TimelineItemCommand; announcement: string; endsSession?: boolean }>
  | Readonly<{ kind: "no-op"; announcement?: string }>
  | Readonly<{ kind: "rejected"; announcement: string }>;

/**
 * Pure command resolution for a keyboard reorder action: given the item
 * being reordered and read-only board state, decides what should happen —
 * a `TimelineItemCommand` to apply, a silent or announced no-op (a
 * boundary like "already first in collection"), or a rejection (a would-be
 * cycle). Mirrors `resolveTimelineCommandFromDrag` in `media-strip.dnd.ts`:
 * same reason that resolver exists (testable command-resolution logic with
 * no React, no side effects) applies here — `use-keyboard-reorder-session.ts`
 * calls this and then just dispatches on `kind` to call `applyCommand`/
 * `announce`/`flashRejection`/`confirmKeyboardReorder`.
 *
 * Returns `null` when `itemId` or its collection can't be found — nothing
 * to resolve, same as the early-return guards this replaced.
 */
export function resolveKeyboardReorderAction({
  itemId,
  action,
  itemLookup,
  collectionsById,
  parentByCollectionId,
  getAdjacentCollectionId,
}: {
  itemId: TimelineItemId;
  action: ResolvableKeyboardReorderAction;
  itemLookup: ItemLookup;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  parentByCollectionId: ReadonlyMap<CollectionId, CollectionId>;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
}): KeyboardReorderResolution | null {
  const found = itemLookup.get(itemId);
  if (!found) return null;
  const { collectionId, index, item } = found;

  const col = collectionsById.get(collectionId);
  if (!col) return null;
  const items = col.items;

  const moveTo = (toIndex: number, message: string, boundaryMessage?: string): KeyboardReorderResolution => {
    if (toIndex < 0 || toIndex >= items.length) {
      return { kind: "no-op", announcement: boundaryMessage };
    }
    if (toIndex === index) {
      return { kind: "no-op" };
    }
    return {
      kind: "move",
      command: { type: "move", itemId, fromCollectionId: collectionId, toCollectionId: collectionId, toIndex },
      announcement: message,
    };
  };

  switch (action) {
    case "move-left":
      return moveTo(index - 1, `Moved "${item.name}" to position ${index}.`, "Already first in collection.");
    case "move-right":
      return moveTo(index + 1, `Moved "${item.name}" to position ${index + 2}.`, "Already last in collection.");
    case "move-home":
      return moveTo(0, `Moved "${item.name}" to start of collection.`);
    case "move-end":
      return moveTo(items.length - 1, `Moved "${item.name}" to end of collection.`);

    case "move-up":
    case "move-down": {
      const direction = action === "move-up" ? "up" : "down";
      const nextCollectionId = getAdjacentCollectionId(collectionId, direction);
      if (!nextCollectionId) {
        return {
          kind: "no-op",
          announcement: direction === "up" ? "Already at the top collection." : "Already at the bottom collection.",
        };
      }

      if (isCollectionItem(item) && wouldCreateCollectionCycle({
        movingCollectionId: item.collectionId,
        targetCollectionId: nextCollectionId,
        collectionsById,
      })) {
        return { kind: "rejected", announcement: "Cannot move a collection into itself or one of its nested collections." };
      }

      const targetCol = collectionsById.get(nextCollectionId);
      const targetColName = targetCol ? targetCol.name : String(nextCollectionId);
      const targetIndex = Math.max(0, Math.min(index, targetCol ? targetCol.items.length : 0));

      return {
        kind: "move",
        command: { type: "move", itemId, fromCollectionId: collectionId, toCollectionId: nextCollectionId, toIndex: targetIndex },
        announcement: `Moved "${item.name}" to collection "${targetColName}" at position ${targetIndex + 1}.`,
      };
    }

    case "nest": {
      const prevItem = index > 0 ? items[index - 1] : null;
      const nextItem = index < items.length - 1 ? items[index + 1] : null;

      let targetColItem: CollectionTimelineItem | null = null;
      if (nextItem && nextItem.kind === "collection") {
        targetColItem = nextItem;
      } else if (prevItem && prevItem.kind === "collection") {
        targetColItem = prevItem;
      }

      if (!targetColItem) {
        return { kind: "no-op", announcement: "No adjacent collection to nest into." };
      }

      const targetCollectionId = targetColItem.collectionId;
      if (isCollectionItem(item) && wouldCreateCollectionCycle({
        movingCollectionId: item.collectionId,
        targetCollectionId,
        collectionsById,
      })) {
        return { kind: "rejected", announcement: "Cannot move a collection into itself or one of its nested collections." };
      }

      return {
        kind: "move",
        command: { type: "nest", itemId, fromCollectionId: collectionId, targetCollectionId },
        announcement: `Moved "${item.name}" into collection "${targetColItem.name}".`,
        endsSession: true,
      };
    }

    case "move-to-parent": {
      const parentCollectionId = parentByCollectionId.get(collectionId);
      const parentCol = parentCollectionId ? collectionsById.get(parentCollectionId) : undefined;

      if (!parentCollectionId || !parentCol) {
        return { kind: "no-op", announcement: "Already at the top level; no parent collection to move out to." };
      }

      // Land right after the collection-item card that represents the
      // current collection, so the item surfaces next to where it came
      // from instead of jumping to the start of the parent's contents.
      const anchorIndex = parentCol.items.findIndex(
        (candidate) => candidate.kind === "collection" && candidate.collectionId === collectionId
      );
      const toIndex = anchorIndex === -1 ? parentCol.items.length : anchorIndex + 1;

      return {
        kind: "move",
        command: { type: "move", itemId, fromCollectionId: collectionId, toCollectionId: parentCollectionId, toIndex },
        announcement: `Moved "${item.name}" out to collection "${parentCol.name}".`,
        endsSession: true,
      };
    }

    default:
      // TS already proves this switch is exhaustive over
      // ResolvableKeyboardReorderAction; this makes a bad cast or a
      // future action added to the union without a case here throw at the
      // dispatch instead of silently returning undefined.
      return assertNever(action);
  }
}
