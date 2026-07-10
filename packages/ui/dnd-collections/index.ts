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
  type NodeMove,
} from "./core/patches";
export {
  decodeDropTarget,
  encodeDropTarget,
  intentDestination,
  isIntentInvalid,
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
export { CollectionPanel, CollectionPanels, NodeCard, NodeCardGhost } from "./react/node-views";
export { HistoryLog, UndoRedoControls } from "./react/history-views";
