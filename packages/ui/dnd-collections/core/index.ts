// The framework-free core: a node-safe entry point exposing ONLY the pure
// graph engine (no React, no dnd-kit, no "use client"). Importing the
// package barrel (`@storyboard/ui/dnd-collections`) pulls in the React views;
// non-UI consumers (e.g. a domain layer that reuses the normalized graph as
// its structural substrate) import `@storyboard/ui/dnd-collections/core`
// instead and stay dependency-light. Every symbol here is also re-exported
// from the package barrel — this is a narrower, purer view of the same code,
// not a second surface.

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
} from "./graph";
export {
  applyCommand,
  type AddNodesCommand,
  type ApplyCommandSuccess,
  type CollectionsCommand,
  type CommandRejection,
  type MediaUpdate,
  type MoveNodesCommand,
  type UpdateMediaCommand,
} from "./commands";
export {
  applyPatch,
  invertPatch,
  type CollectionsPatch,
  type NodeAdd,
  type NodeMove,
  type NodeUpdate,
} from "./patches";
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
} from "./intents";
export { createHistory, type CollectionsHistory, type HistoryEntry } from "./history";
export {
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  resolveTrashCommand,
  resolveTrimCommand,
  resolveWindowMoveCommand,
  type GridRowMoveRejection,
  type KeyboardMoveAction,
  type KeyboardRejection,
  type KeyboardTrashRejection,
  type KeyboardTrimAction,
  type KeyboardTrimRejection,
  type KeyboardWindowMoveAction,
  type KeyboardWindowMoveRejection,
} from "./keyboard";
