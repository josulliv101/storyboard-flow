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
  isVideoMedia,
  mediaDurationSeconds,
  parseCollectionItemNode,
  parseGraphSpec,
  videoFrameCount,
  parseNodeId,
  validateGraph,
  EMPTY_GRAPH,
  MAX_VIDEO_FRAMES,
  SECONDS_PER_VIDEO_FRAME,
  type BuildGraphError,
  type CollectionNode,
  type CollectionsValidationError,
  type CollectionsGraph,
  type CollectionItemNode,
  type GraphInvariantViolation,
  type GraphValidationError,
  type GraphNodeSpec,
  type ImageMediaNode,
  type MediaNode,
  type NodeId,
  type Result,
  type VideoMediaNode,
} from "./core/graph";
export {
  applyCommand,
  type AddNodesCommand,
  type ApplyCommandSuccess,
  type CollectionsCommand,
  type CommandRejection,
  type MediaUpdate,
  type MoveNodesCommand,
  type UpdateMediaCommand,
} from "./core/commands";
export {
  applyPatch,
  invertPatch,
  type CollectionsPatch,
  type NodeAdd,
  type NodeMove,
  type NodeUpdate,
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
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  resolveTrimCommand,
  type GridRowMoveRejection,
  type KeyboardMoveAction,
  type KeyboardRejection,
  type KeyboardTrimAction,
  type KeyboardTrimRejection,
} from "./core/keyboard";

// React bindings (store + provider + default views)
export {
  InvalidInitialGraphError,
  createCollectionsStore,
  CollectionsStoreProvider,
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

// Extension seams for custom views (cards, panels, virtualized containers)
// that plug into the same store, FLIP scope, and collision pipeline as the
// built-ins. `applyPatch` (exported under Core above) is the only unchecked
// primitive here — apply patches only to the graph state they were produced
// against.
export {
  CollectionsContainerContext,
  useCollectionsContainer,
  type CollectionsContainerValue,
} from "./react/container-context";
export {
  VIRTUAL_INSERT_DATA_KEY,
  isVirtualInsertTarget,
  type VirtualInsertTarget,
} from "./react/virtual-droppable";
export { useEdgeAutoScroll } from "./react/use-edge-autoscroll";

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
