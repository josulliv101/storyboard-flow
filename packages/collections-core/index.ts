// The framework-free graph engine, as its own package: node-safe, no React,
// no dnd-kit, no "use client". Non-UI consumers (the timeline-domain
// adapter, server code) depend on THIS package and stay dependency-light;
// the UI package (`@storyboard/ui/dnd-collections`) builds its React views
// on top and re-exports every symbol here through its barrel and its
// `core/*` shims — one engine, two entry heights, not a second surface.

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
export { hydrateCollection, type HydrateRejection } from "./hydrate";
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
