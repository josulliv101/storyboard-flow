"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
} from "react";

import { type CollectionItemNode, type NodeId } from "../core/graph";

// The consumer-content seam: dnd-collections owns BEHAVIOR and GEOMETRY
// (drag wiring, selection, trim gestures, aria, measurement, indicators);
// consumers own PIXELS. The shell (`NodeCard`) renders a registered content
// component inside its interactive surface and hands it the node plus a few
// rarely-changing primitives — nothing per-frame ever reaches content, so a
// drag over one card still re-renders that card alone.
//
// Components are registered ONCE at the provider (or per view) and MUST be
// identity-stable — defined at module scope, not inline. An inline
// definition creates a new component type per render; React then unmounts
// and remounts every card's content subtree (component identity, not just
// memo, is what's at stake). `useCollectionsComponentsValue` warns when it
// sees churn.

/** How item drags start on a card — see NodeCard's prop docs. */
export type NodeCardDragActivation = "body" | "handle" | "hold";

export type CollectionItemContentProps = Readonly<{
  id: NodeId;
  /** Stable reference — new identity ONLY on a data commit to this node. */
  node: CollectionItemNode;
  /** Live child count for collections; 0 for media. */
  childCount: number;
  selected: boolean;
  /** Rejection flash (a refused drop) — the default content pulses a ring. */
  rejected: boolean;
  /** This card is being dragged (it sits dimmed in place under the ghost). */
  isDragSource: boolean;
  /**
   * The card's drag-activation mode. Layout fact your pixels may need: in
   * "handle" mode the shell overlays an 18px grip bar across the top of the
   * card — leave room for it (the default content pads its top).
   */
  dragActivation: NodeCardDragActivation;
}>;

/**
 * A consumer item renderer. Rendered INSIDE the card's <button> surface, so
 * it must be presentational: no interactive elements (buttons, links,
 * inputs) — interactivity belongs to the shell (selection, drag, trim).
 * Wrap it in `React.memo` and define it at module scope.
 */
export type CollectionItemContentComponent = ComponentType<CollectionItemContentProps>;

export type CollectionGhostContentProps = Readonly<{
  /** The primary dragged node (pressed card / palette factory result). */
  node: CollectionItemNode;
  /** How many MORE items ride the drag (multi-drag) — 0 for a single item. */
  extraCount: number;
}>;

/** The drag-overlay ghost renderer. Fills a wrapper dnd-kit sizes to the
 *  dragged card's measured rect, so the ghost matches the real display
 *  width — fixed OR variable (virtual strips). */
export type CollectionGhostContentComponent = ComponentType<CollectionGhostContentProps>;

export type CollectionsComponents = Readonly<{
  /** Replaces the card pixels everywhere (panels, virtual views). Per-view
   *  `itemContent` props override this registry entry. */
  ItemContent?: CollectionItemContentComponent;
  /** Replaces the drag-overlay ghost pixels. */
  GhostContent?: CollectionGhostContentComponent;
}>;

const EMPTY_COMPONENTS: CollectionsComponents = {};

export const CollectionsComponentsContext =
  createContext<CollectionsComponents>(EMPTY_COMPONENTS);

export function useCollectionsComponents(): CollectionsComponents {
  return useContext(CollectionsComponentsContext);
}

let warnedUnstableComponents = false;

/**
 * Normalizes the provider's `components` prop into a context value whose
 * identity follows the FIELD identities (an inline `components={{ ... }}`
 * object literal per render is fine as long as the components themselves are
 * stable). Warns once if a component identity churns between renders — that
 * remounts every card's content subtree and defeats memoization.
 */
export function useCollectionsComponentsValue(
  components?: CollectionsComponents
): CollectionsComponents {
  const ItemContent = components?.ItemContent;
  const GhostContent = components?.GhostContent;
  const value = useMemo<CollectionsComponents>(
    () => (ItemContent || GhostContent ? { ItemContent, GhostContent } : EMPTY_COMPONENTS),
    [ItemContent, GhostContent]
  );

  const previousRef = useRef(value);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = value;
    if (warnedUnstableComponents || previous === value) return;
    const churned =
      (previous.ItemContent && value.ItemContent && previous.ItemContent !== value.ItemContent) ||
      (previous.GhostContent && value.GhostContent && previous.GhostContent !== value.GhostContent);
    if (churned) {
      warnedUnstableComponents = true;
      console.warn(
        "dnd-collections: a `components` entry changed identity between renders. " +
          "Define ItemContent/GhostContent at module scope (a new component type per " +
          "render remounts every card's content and defeats memoization)."
      );
    }
  }, [value]);

  return value;
}
