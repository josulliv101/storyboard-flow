"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
} from "react";

import {
  type CollectionItemNode,
  type MediaNode,
  type NodeId,
  type VideoMediaNode,
} from "../core/graph";

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
  /**
   * True when the shell renders trim handles on this card (a media node in
   * a trim-enabled view). The default content gates its duration readout on
   * it; pair yours with `useLiveTrim(id)` for a readout that tracks the
   * drag live.
   */
  trimEnabled: boolean;
}>;

/**
 * A consumer item renderer. Rendered INSIDE the card's <button> surface, so
 * it must be presentational: no interactive elements (buttons, links,
 * inputs) — interactivity belongs to the shell (selection, drag, trim).
 * Wrap it in `React.memo` and define it at module scope.
 */
export type CollectionItemContentComponent = ComponentType<CollectionItemContentProps>;

/**
 * What a virtual view passes to whatever renders each item. The default
 * renderer is `NodeCard` (these are exactly its props), so a custom shell is
 * drop-in: same id, same slot-filling `className`, same activation/roving/
 * trim wiring to forward or reinterpret.
 */
export type CollectionItemShellProps = Readonly<{
  id: NodeId;
  /** Slot sizing from the view — virtual views pass "h-full w-full". */
  className?: string;
  dragActivation?: NodeCardDragActivation;
  rovingTabIndex?: number;
  trimPixelsPerSecond?: number;
  itemContent?: CollectionItemContentComponent;
}>;

/**
 * A full ITEM renderer for the virtual views — the shell seam one level up
 * from `itemContent`. `ItemContent` swaps the pixels inside NodeCard's
 * <button>; an item SHELL replaces NodeCard itself, which is the only way to
 * put legally interactive controls (a real <button>, an <input>) on a card:
 * compose them via the `CollectionItem` primitives as SIBLINGS of
 * `CollectionItem.SelectionSurface` instead of nesting them in a button.
 * Identity-stable (module scope), like every registry entry. Views that
 * don't need it keep the NodeCard default.
 */
export type CollectionItemShellComponent = ComponentType<CollectionItemShellProps>;

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

export type CollectionTrimHandleContentProps = Readonly<{
  /** "left" = video trim-in; "right" = image duration / video trim-out. */
  side: "left" | "right";
  node: MediaNode;
  selected: boolean;
}>;

/**
 * The VISUALS inside a trim handle's hit zone. The shell keeps the zone
 * itself — positioning, width, cursor, the pointer gesture, and its
 * sibling-of-the-button DOM shape (load-bearing: a handle press must never
 * reach the drag sensor or the strip's pan) — and renders this component
 * filling it. Presentational only, like ItemContent.
 */
export type CollectionTrimHandleContentComponent =
  ComponentType<CollectionTrimHandleContentProps>;

export type CollectionTrimOverviewContentProps = Readonly<{
  node: VideoMediaNode;
  pixelsPerSecond: number;
  /** Live drag values override the node's committed trim mid-gesture. */
  trimInSeconds: number;
  trimOutSeconds: number;
  /** The full source's rendered width (`fullDurationSeconds * pps`, min 1px). */
  fullWidth: number;
}>;

/**
 * The BACKGROUND pixels of the source-window overview (`VirtualStrip`'s
 * floating tooltip for a selected video): the full-source filmstrip and any
 * labels. The package keeps the overview's geometry and interactivity — the
 * dimmed trimmed-room layers, the amber showing-window, its trim grips, and
 * the filmstrip-move gesture. Presentational only, like the other slots.
 */
export type CollectionTrimOverviewContentComponent =
  ComponentType<CollectionTrimOverviewContentProps>;

export type CollectionsComponents = Readonly<{
  /** Replaces the card pixels everywhere (panels, virtual views). Per-view
   *  `itemContent` props override this registry entry. */
  ItemContent?: CollectionItemContentComponent;
  /** Replaces the whole item renderer in the VIRTUAL views (NodeCard by
   *  default) — see CollectionItemShellComponent. Per-view `itemShell`
   *  props override this registry entry. Panels keep NodeCard. */
  ItemShell?: CollectionItemShellComponent;
  /** Replaces the drag-overlay ghost pixels. */
  GhostContent?: CollectionGhostContentComponent;
  /** Replaces the pixels INSIDE the trim-handle hit zones. */
  TrimHandleContent?: CollectionTrimHandleContentComponent;
  /** Replaces the source-window overview's filmstrip/label pixels. */
  OverviewContent?: CollectionTrimOverviewContentComponent;
}>;

const EMPTY_COMPONENTS: CollectionsComponents = {};

export const CollectionsComponentsContext =
  createContext<CollectionsComponents>(EMPTY_COMPONENTS);

export function useCollectionsComponents(): CollectionsComponents {
  return useContext(CollectionsComponentsContext);
}

/**
 * Normalizes the provider's `components` prop into a context value whose
 * identity follows the FIELD identities (an inline `components={{ ... }}`
 * object literal per render is fine as long as the components themselves are
 * stable). In development builds, warns once PER INSTANCE when any entry
 * changes identity between renders — including appearing/disappearing
 * entries: either way React sees a new component type and remounts every
 * card's content subtree, defeating memoization.
 */
export function useCollectionsComponentsValue(
  components?: CollectionsComponents
): CollectionsComponents {
  const ItemContent = components?.ItemContent;
  const ItemShell = components?.ItemShell;
  const GhostContent = components?.GhostContent;
  const TrimHandleContent = components?.TrimHandleContent;
  const OverviewContent = components?.OverviewContent;
  const value = useMemo<CollectionsComponents>(
    () =>
      ItemContent || ItemShell || GhostContent || TrimHandleContent || OverviewContent
        ? { ItemContent, ItemShell, GhostContent, TrimHandleContent, OverviewContent }
        : EMPTY_COMPONENTS,
    [ItemContent, ItemShell, GhostContent, TrimHandleContent, OverviewContent]
  );

  const previousRef = useRef(value);
  const warnedRef = useRef(false);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = value;
    if (process.env.NODE_ENV === "production") return;
    // The memo above keys on exactly the registry's fields, so a new value
    // identity IS a field-identity change — symmetric by construction.
    if (warnedRef.current || previous === value) return;
    warnedRef.current = true;
    console.warn(
      "dnd-collections: a `components` entry changed identity between renders. " +
        "Define ItemContent/ItemShell/GhostContent/TrimHandleContent/OverviewContent " +
        "at module scope — a new component type per render remounts every card's " +
        "content and defeats memoization."
    );
  }, [value]);

  return value;
}
