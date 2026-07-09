import { type HTMLAttributes, type ReactNode, type Ref } from "react";

import {
  type MediaStripDndAdapterId,
  type MediaStripDndAutoScrollOptions,
  type MediaStripDndCollisionDetection,
  type MediaStripDndDragEndEvent,
  type MediaStripDndDragMoveEvent,
  type MediaStripDndDragOverEvent,
  type MediaStripDndDragStartEvent,
  type MediaStripDndIdentifier,
} from "./core/media-strip.dnd-adapter";
import { type CollectionId, type DropPlacement } from "./core/media-strip.types";

export type MediaStripDndPointerInput = Readonly<{
  clientX: number;
  clientY: number;
}>;

export type MediaStripDndDropTargetInfo = Readonly<{
  nestTargetId: CollectionId | null;
  placement: DropPlacement | null;
}>;

export type MediaStripDndProviderProps = {
  adapter: MediaStripDndAdapter;
  autoScroll?: MediaStripDndAutoScrollOptions;
  children: ReactNode;
  dndKit?: Readonly<{
    activationDistance: number;
    collisionDetection?: MediaStripDndCollisionDetection;
  }>;
  /**
   * Resolves nest-target and reorder-placement info for the pointer-driven
   * adapters (pragmatic, native-html5), which report a raw `element`/`input`
   * on every drag move rather than running dnd-kit-style collision
   * detection. dnd-kit ignores this — it resolves the same info itself via
   * the `dndKit.collisionDetection` callback.
   */
  getDropTargetInfo?: (args: {
    activeId: MediaStripDndIdentifier;
    overId: MediaStripDndIdentifier;
    element: Element;
    input: MediaStripDndPointerInput;
  }) => MediaStripDndDropTargetInfo;
  onDragCancel?: () => void;
  onDragEnd?: (event: MediaStripDndDragEndEvent) => void;
  onDragMove?: (event: MediaStripDndDragMoveEvent) => void;
  onDragOver?: (event: MediaStripDndDragOverEvent) => void;
  onDragStart?: (event: MediaStripDndDragStartEvent) => void;
};

export type MediaStripSortableRenderProps = {
  attributes: HTMLAttributes<HTMLElement>;
  isDragging: boolean;
  listeners: HTMLAttributes<HTMLElement>;
  setActivatorNodeRef: Ref<HTMLButtonElement>;
  setNodeRef: Ref<HTMLDivElement>;
  transformStyle: string | undefined;
  transition: string | undefined;
};

export type MediaStripDroppableRenderProps = {
  isOver: boolean;
  setNodeRef: Ref<HTMLDivElement>;
};

export type MediaStripDndDragOverlayProps = {
  children: ReactNode;
};

export type MediaStripDndDroppableProps = {
  children: (props: MediaStripDroppableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
};

export type MediaStripDndSortableItemsProps = {
  children: ReactNode;
  items: MediaStripDndIdentifier[];
};

export type MediaStripDndSortableItemProps = {
  children: (props: MediaStripSortableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
};

export type MediaStripDndAdapterComponents = Readonly<{
  DragOverlay: (props: MediaStripDndDragOverlayProps) => ReactNode;
  Droppable: (props: MediaStripDndDroppableProps) => ReactNode;
  Provider: (props: MediaStripDndProviderProps) => ReactNode;
  SortableItem: (props: MediaStripDndSortableItemProps) => ReactNode;
  SortableItems: (props: MediaStripDndSortableItemsProps) => ReactNode;
}>;

/**
 * What an adapter actually does today, as opposed to what the shared
 * `MediaStripDndAdapterComponents` interface makes every adapter *look*
 * like it does. All three adapters implement the same five component
 * slots, but dnd-kit gets sortable transforms, collision detection, and
 * pointer-following overlay/autoscroll for free from the library, while
 * pragmatic and native-html5 hand-roll the overlay position and autoscroll
 * themselves and never run a multi-candidate collision search. Declaring
 * this explicitly means a consumer (or a test) can branch or assert on
 * actual behavior instead of assuming parity between adapters.
 */
export type MediaStripDndCapabilities = Readonly<{
  /** Item elements receive a live CSS transform while sorting (dnd-kit's `useSortable`). */
  supportsSortableTransforms: boolean;
  /** The adapter runs a multi-candidate collision search rather than a single current drop target. */
  supportsCollisionDetection: boolean;
  /** The adapter renders a custom `DragOverlay`/`DragOverlayItem` at all. True for all adapters today. */
  supportsCustomDragOverlay: boolean;
  /** The adapter wires up a built-in keyboard-driven drag sensor. False for all adapters today — this package's keyboard reordering (`use-keyboard-reorder-session.ts`) is implemented independently of the DnD adapter layer. */
  supportsKeyboardSensor: boolean;
  /** The adapter must scroll the strip itself during a drag (`dom-autoscroll.ts`) rather than relying on the library's built-in autoscroll. */
  requiresManualAutoScroll: boolean;
  /** The adapter must track pointer position itself to position the drag overlay, rather than the library following the pointer automatically. */
  requiresManualOverlayPosition: boolean;
}>;

export type MediaStripDndAdapter = MediaStripDndAdapterComponents & Readonly<{
  id: MediaStripDndAdapterId;
  capabilities: MediaStripDndCapabilities;
}>;
