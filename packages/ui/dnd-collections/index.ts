// dnd-collections — a normalized collections graph with a pure command
// reducer and reversible patches at its core, projected into React through
// selector subscriptions, with dnd-kit supplying sensors/collision/overlay.
// See core/graph.ts for the source-of-truth model; nothing mutates the
// graph except commands dispatched through the store.

// Core (pure — no React, no DOM)
export {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  getDocumentOrder,
  isCollection,
  isSameOrAncestor,
  parseNodeId,
  EMPTY_GRAPH,
  type BuildGraphError,
  type CollectionNode,
  type CollectionsGraph,
  type CollectionItemNode,
  type GraphInvariantViolation,
  type GraphNodeSpec,
  type MediaNode,
  type NodeId,
  type Result,
} from "./core/graph";
export {
  applyCommand,
  type ApplyCommandSuccess,
  type CollectionsCommand,
  type CommandRejection,
} from "./core/commands";
export {
  applyPatch,
  invertPatch,
  type CollectionsPatch,
  type NodeAdd,
  type NodeMove,
} from "./core/patches";
export {
  decodeDropTarget,
  encodeDropTarget,
  intentDestination,
  isIntentInvalid,
  resolveAddCommandFromIntent,
  resolveCommandFromIntent,
  resolveDropIntent,
  type DropIntent,
  type DropTarget,
  type IntentRejection,
  type PanelChildRect,
  type RectLike,
} from "./core/intents";
export { createHistory, type CollectionsHistory, type HistoryEntry } from "./core/history";
export {
  resolveKeyboardCommand,
  type KeyboardMoveAction,
  type KeyboardRejection,
} from "./core/keyboard";

// React bindings (store + provider + default views)
export {
  createCollectionsStore,
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsChange,
  type CollectionsInteraction,
  type CollectionsSnapshot,
  type CollectionsStore,
} from "./react/collections-store";
export { DndCollections, type DndCollectionsProps } from "./react/DndCollections";
export {
  CollectionPanel,
  CollectionPanels,
  NodeCard,
  NodeCardGhost,
  type NodeCardDragActivation,
} from "./react/node-views";
export { HistoryLog, UndoRedoControls } from "./react/history-views";
export { PaletteItem, type PaletteItemProps } from "./react/palette";
export { TrashTarget } from "./react/trash-target";
export {
  usePanWithMomentum,
  type PanWithMomentumOptions,
} from "./react/use-pan-with-momentum";

// Virtualized views (TanStack Virtual): full DnD via insert-at-index
// container collision, variable widths + pan-to-scroll (strip), fixed
// cells + responsive columns (grid). VIRTUALIZATION-PLAN.md is the build log.
export {
  VirtualStrip,
  type VirtualStripHandle,
  type VirtualStripProps,
} from "./virtual/VirtualStrip";
export {
  VirtualGrid,
  type VirtualGridHandle,
  type VirtualGridProps,
} from "./virtual/VirtualGrid";
