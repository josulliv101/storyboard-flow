// The framework-free graph engine, as its own package: node-safe, no React,
// no dnd-kit, no "use client". Non-UI consumers (the timeline-domain
// adapter, server code) depend on THIS package and stay dependency-light;
// the UI package (`@storyboard/ui/dnd-collections`) builds its React views on
// top and re-exports the symbols its consumers need through its own barrel.
//
// THIS PACKAGE IS THE ONLY PATH TO THE ENGINE. There used to be a second one:
// `dnd-collections/core/*` held a re-export shim per module, so `./core/graph`
// resolved too. PL16-016 deleted them and repointed all 75 imports here,
// because two names for one module is how an engine starts looking like it
// lives in two places. Import by subpath — `@storyboard/collections-core/graph`.

export {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  getDocumentOrder,
  isCollection,
  hasSourceWindow,
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
  type AudioMediaNode,
  type ImageMediaNode,
  type MediaNode,
  type NodeId,
  type Result,
  type VideoMediaNode,
} from "./graph";
export {
  applyCommand,
  MIN_MEDIA_DURATION_SECONDS,
  type AddNodesCommand,
  type ApplyCommandSuccess,
  type CollectionsCommand,
  type CommandRejection,
  type MediaUpdate,
  type MoveNodesCommand,
  type SetNodePlacementCommand,
  type UpdateMediaCommand,
} from "./commands";
export { hydrateCollection, type HydrateRejection } from "./hydrate";
export {
  applyPatch,
  invertPatch,
  verifyPatchApplies,
  type CollectionsPatch,
  type NodeAdd,
  type NodeMove,
  type NodeUpdate,
  type ReplayRejection,
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
