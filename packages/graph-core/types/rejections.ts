// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { SealReason } from "./graph";
import type { Issue, NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 6. Rejections — every failure is Result-shaped, never thrown
// ---------------------------------------------------------------------------

/**
 * Deliberately FLAT rather than a fifteen-member discriminated union: the code
 * is a literal union (so a `switch` over it is still exhaustive-checkable) and
 * the context fields are optional. Six modules construct these; a flat shape
 * has one way to be written and cannot drift per-variant.
 */
export type RejectionCode =
  /** The graph came from a different engine instance. */
  | "foreign-graph"
  /** Zero nodes / zero seeds / zero edits. A no-op patch has no honest inverse. */
  | "empty-command"
  | "unknown-node"
  | "unknown-parent"
  | "unknown-kind"
  | "not-a-container"
  /** Dropping into `unloaded` / `reference` / `missing`. A post-removal index
   *  into children you have never seen has no honest value. This is a
   *  graph-level truth, not something to push to an app-level policy. */
  | "target-not-loaded"
  /** The same id twice in one move list — one removal, two insertions, one
   *  node in two children arrays. A blind retry did exactly this in
   *  production. */
  | "duplicate-node-ids"
  | "index-out-of-range"
  | "would-create-cycle"
  | "cannot-move-root"
  | "cannot-remove-root"
  /** Removing a container with a non-`loaded` subtree without `allowUnloaded`. */
  | "unloaded-subtree"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed"
  /** A second non-`reference` placement for one `sourceKey`. Insert a
   *  `reference` instead — that is the typed answer the consumer is meant to
   *  give. */
  | "duplicate-owner"
  /** Sealed nodes move and delete, but do not edit. */
  | "node-sealed"
  /** `edit.kind` does not match the target node's kind. */
  | "kind-mismatch"
  /** The node type's own `applyEdit` said no. See `editRejection`. */
  | "edit-rejected"
  /** A seed's data failed its own `parse`. See `issues`. */
  | "parse-failed"
  /**
   * A consumer `contentKey`/`sourceKey` threw.
   *
   * NOT swallowed into `null` — that would silently disable the single-owner
   * rule — and no longer allowed to travel raw out of a door that promises a
   * `Result`. Named identically on every rejection family for the reason
   * `duplicate-owner` is: a consumer handling one handles them all.
   */
  | "node-type-threw"
  | "leaf-seed-with-children"
  /**
   * A gesture that would push the graph past `EngineConfig.maxNodes` or
   * `maxDepth`.
   *
   * Named to mirror `would-create-cycle` rather than the ingress pair
   * `document-too-large` / `document-too-deep`, because the subject is
   * different: those describe a DOCUMENT that is already too big, this
   * describes a COMMAND that has not happened. The ceilings used to live only
   * on the ingress doors, so the reducer could grow a graph that
   * `engine.serialize` then emitted and `engine.deserialize` refused — the
   * engine producing documents it cannot read back.
   */
  | "would-exceed-max-nodes"
  | "would-exceed-max-depth"
  /** The consumer's PRE-commit `commandPolicy` vetoed it. */
  | "policy-rejected";

export type Rejection = Readonly<{
  code: RejectionCode;
  message: string;
  nodeIds?: readonly NodeId[];
  parentId?: NodeId;
  index?: number;
  kind?: string;
  sourceKey?: string;
  /** The existing owner, on `"duplicate-owner"`. */
  ownerId?: NodeId;
  issues?: readonly Issue[];
  /** The node type's verbatim complaint, on `"edit-rejected"`. */
  editRejection?: EditRejection;
  /** The ceiling that was hit, on the two `would-exceed-*` codes. Named the
   *  same as `StructuralError`'s pair so a consumer reporting a limit to the
   *  user reads it the same way whichever door refused. */
  limit?: number;
  /** What the graph WOULD have reached. */
  actual?: number;
}>;

/**
 * A node type's own refusal. Consumer-authored, so `code` is a free string — the
 * engine only relays it.
 */
export type EditRejection = Readonly<{
  code: string;
  message: string;
  issues?: readonly Issue[];
}>;

/**
 * Why a DORMANT patch can no longer be applied. Loading grows the graph while
 * history entries sleep, so every undo/redo is gated by `verifyPatchApplies` —
 * the predecessor reproduced two real corruptions from omitting exactly this
 * check.
 */
export type ReplayRejectionCode =
  | "foreign-graph"
  | "node-missing"
  | "node-exists"
  | "parent-missing"
  | "parent-not-loaded"
  | "index-out-of-range"
  /** Undoing an insert whose node has gained children since. */
  | "node-not-empty"
  | "kind-mismatch"
  /** The recorded `before` is no longer what the node holds. */
  | "data-mismatch"
  /**
   * Replaying this patch would put a second owner on one `sourceKey`.
   *
   * Reachable only because `applyNonUndoableWrite` is a NON-UNDOABLE write: it can move a
   * live node onto a key a sleeping patch still carries, and the replay would
   * then re-install the original owner beside it. Mirrors `RejectionCode`'s
   * member of the same name so a consumer handling one handles the other.
   */
  | "duplicate-owner"
  /**
   * Replaying this move patch would make a node its own ancestor.
   *
   * Mirrors `RejectionCode`'s member of the same name, and needs no exotic
   * hand-built patch to reach: two ORDINARY reducer-produced moves converge
   * into it. Peer A moves Y into X and peer B moves X into Y, each legal
   * against its own graph; A's patch arriving at B closes the ring. Neither
   * node is the other's ancestor in B's pre-state, so the check that catches
   * this must run against the post-removal overlay, not `parentById`.
   *
   * The cost of not having it: the cycle detaches from every root, and
   * `serializeGraph` deliberately emits unreachable nodes rather than dropping
   * them, so the document saves cleanly and `deserialize` then refuses it
   * forever with `unreachable-node`.
   */
  | "would-create-cycle"
  /** A consumer `contentKey`/`sourceKey` threw. See `RejectionCode`. */
  | "node-type-threw"
  /**
   * Replaying this insert patch would take the graph past `maxNodes`.
   *
   * Reachable because `Store.load` does not touch history: a lazy page can
   * legitimately spend the headroom a delete just freed while that removal
   * patch still sleeps on the undo stack, and undoing it then grows the graph
   * into a document `deserialize` refuses at the same config. Mirrors
   * `RejectionCode`'s member of the same name, and carries `limit`/`actual`
   * for the same reason it does.
   */
  | "would-exceed-max-nodes"
  /**
   * Replaying this insert or move patch would nest past `maxDepth`.
   *
   * THE TWIN OF `"would-exceed-max-nodes"`, and it was missing while that one
   * was not — which is the whole shape of the defect. `maxDepth` was enforced
   * at three forward doors (`applyInsertNodes`, `applyMoveNodes`, and both
   * ingress doors) and at none of the replay ones, so the ceiling held against
   * every command and against every document, and not against undo or redo.
   *
   * Reachable by the same lever the node ceiling names, because `Store.load`
   * touches neither stack: move an UNLOADED container somewhere legal (it
   * counts as one level), undo that move, fill the container two levels deep
   * while it sits shallow, then redo. MEASURED before this existed, at
   * `maxDepth: 4` — the redo was accepted, the graph reached depth 6,
   * `serializeGraph` wrote it, and `deserialize` at the same config then
   * answered `document-too-deep` forever. `findInvariantViolation` cannot catch
   * it either: `ViolationCode` has no depth member, because depth is a ceiling
   * a consumer chose and not a structural truth about the graph.
   *
   * Carries `limit`/`actual` for the reason its twin does.
   */
  | "would-exceed-max-depth"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed";

export type ReplayRejection = Readonly<{
  code: ReplayRejectionCode;
  message: string;
  nodeId?: NodeId;
  parentId?: NodeId;
  index?: number;
  /** The ceiling that was hit, on `"would-exceed-max-nodes"` and
   *  `"would-exceed-max-depth"`. Named the same as `Rejection`'s pair so a
   *  consumer reporting a limit to the user reads it the same way whichever
   *  door refused. */
  limit?: number;
  /** What the graph WOULD have reached — nodes or levels, per the code. */
  actual?: number;
}>;

export type LoadRejectionCode =
  | "foreign-graph"
  | "unknown-node"
  | "not-a-container"
  /** Only `unloaded` may be loaded. `reference` never owns; `loaded` is done;
   *  `missing` is a confirmed answer, not a gap. */
  | "target-not-unloaded"
  /** The incoming document reuses an id the host graph already holds. */
  | "id-collision"
  /** A consumer `contentKey`/`sourceKey` threw. See `RejectionCode`. */
  | "node-type-threw"
  | "malformed-document"
  /** The store was destroyed. Every mutating call refuses rather than writing
   *  into a graph nothing is listening to — see `Store.destroy`. */
  | "store-destroyed";

export type LoadRejection = Readonly<{
  code: LoadRejectionCode;
  message: string;
  nodeId?: NodeId;
  collidingIds?: readonly NodeId[];
  /** Present on `"malformed-document"` — the document's own failure. */
  cause?: StructuralError;
}>;

/** The whole document is unusable. Per-node content failures do NOT land here
 *  by default — they seal. */
export type StructuralErrorCode =
  | "malformed-document"
  | "unsupported-format-version"
  | "invalid-node-id"
  | "duplicate-node-id"
  | "dangling-child"
  /** One id in two children arrays. Combined with "roots appear as no one's
   *  child", this IS the forest condition — checked by counting, in one pass,
   *  with an explicit stack. Never recursion: depth is hostile input. */
  | "multi-parent"
  | "invalid-children-state"
  | "unknown-root"
  | "root-not-container"
  | "unreachable-node"
  // NO `"leaf-with-children"` here, and its absence is the point. Ingress does
  // not REJECT a leaf that arrived carrying children — it seals that node
  // as `"shape-mismatch"` and keeps the rest of the document, which is the whole
  // design: one node's confusion must not cost the user their file. The member
  // sat in this union unreachable, and a consumer writing an exhaustive switch
  // over `StructuralErrorCode` had to handle a case ./serialize cannot produce.
  //
  // `ViolationCode` still declares it, correctly — the AUDIT can find a leaf
  // with children on a graph built in memory, and `graph/invariants` returns
  // exactly that. Two unions, two different questions.
  | "duplicate-owner"
  | "summary-parse-failed"
  /** `onUnknownKind` / `onParseFailure` was set to `"reject"`. */
  | "ingress-rejected"
  /** More nodes than `EngineConfig.maxNodes`. See `DEFAULT_MAX_NODES`. */
  | "document-too-large"
  /** Nested deeper than `EngineConfig.maxDepth`, which is opt-in. */
  | "document-too-deep"
  /** A consumer `contentKey`/`sourceKey` threw. See `RejectionCode`. */
  | "node-type-threw";

export type StructuralError = Readonly<{
  code: StructuralErrorCode;
  message: string;
  nodeId?: NodeId;
  /** Raw id text, when it was too malformed to brand. */
  rawId?: string;
  issues?: readonly Issue[];
  /** Present on `"ingress-rejected"`. */
  ingress?: readonly IngressError[];
  /** Present on the two bound refusals: the ceiling that was in force, and
   *  what the document actually presented. A consumer telling a person why
   *  their document was refused needs both, and parsing them back out of
   *  `message` is not an interface. */
  limit?: number;
  actual?: number;
}>;

/**
 * One node failed the content trust boundary. Reported in `LoadReport` when
 * sealed, or lifted into `StructuralError.ingress` when the engine is
 * configured to reject.
 */
export type IngressError = Readonly<{
  nodeId: NodeId;
  kind: string;
  reason: SealReason;
  issues: readonly Issue[];
}>;

/** What `findInvariantViolation` reports. Both directions of every children
 *  rule are here, so `loaded` and `childrenById` cannot drift apart. */
export type ViolationCode =
  | "empty-node-id"
  | "duplicate-node-id"
  | "dangling-child"
  | "multi-parent"
  | "cycle"
  | "unreachable-node"
  | "root-not-container"
  | "root-is-child"
  | "leaf-with-children"
  | "loaded-collection-missing-children-entry"
  | "unloaded-collection-with-children"
  | "parent-index-disagrees"
  | "missing-parent-entry"
  | "missing-subtree-rev"
  | "duplicate-owner"
  | "derived-index-stale"
  /** A consumer `contentKey`/`sourceKey` threw while the audit read it. See
   *  `RejectionCode`. */
  | "node-type-threw";

export type Violation = Readonly<{
  code: ViolationCode;
  message: string;
  nodeId?: NodeId;
  parentId?: NodeId;
  otherNodeId?: NodeId;
  sourceKey?: string;
}>;
