// The ONE seam onto the collections graph engine (see
// docs/storyboard-graph-architecture.md). Every other module in this package
// imports the engine from here, never directly — the engine's home is a
// single decision recorded in one file. Today it is the standalone
// framework-free @storyboard/collections-core package (no React, no dnd-kit
// — node-safe), so this domain package carries no UI dependency at runtime.

export {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  hydrateCollection,
  mediaDurationSeconds,
  parseNodeId,
  type CollectionItemNode,
  type CollectionsGraph,
  type CollectionsPatch,
  type GraphNodeSpec,
  type NodeId,
  type Result,
} from "@storyboard/collections-core";
