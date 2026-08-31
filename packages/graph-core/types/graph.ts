// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { ConsumerDefinedNodeType, WidenedNodeType } from "./node-types";
import type { Issue, NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 3. The graph
// ---------------------------------------------------------------------------

/**
 * FOUR states, not three, and not a boolean.
 *
 * The predecessor confesses the cost of collapsing them in its own source:
 * "No children in the graph means its document has not been loaded — or it is
 * genuinely empty, and the two are indistinguishable from here." Every
 * downstream compensation (an uncertainty flag threaded through preview
 * resolution, a defaulted `isKnownMissing` predicate that silently restores
 * the wrong behaviour when a call site forgets it, a 133-document branch stuck
 * at "no duration") is scar tissue from that one missing bit.
 *
 * `loaded` is the ONLY state with a `childrenById` entry. The other three have
 * none — checked BOTH ways by `findInvariantViolation`, so the two
 * representations cannot drift.
 */
export type ChildrenState =
  /** `childrenById` HAS an entry, possibly `[]`. This placement owns the subtree. */
  | Readonly<{ status: "loaded" }>
  /** No entry YET. This placement owns the subtree; `loadChildren` targets these. */
  | Readonly<{ status: "unloaded" }>
  /**
   * No entry EVER. Another placement owns this subtree. Structurally childless
   * forever, carrying only a summary — which is what makes the placement
   * forest a genuine tree and cycle detection decidable with no lazy-loading
   * caveat.
   */
  | Readonly<{ status: "reference" }>
  /**
   * Storage CONFIRMED gone ⇒ exactly empty. This is KNOWLEDGE, not absence of
   * it, which is why a subtree whose only gaps are `missing` folds to
   * certainty `"exact"`.
   */
  | Readonly<{ status: "missing"; reason: string }>;

/**
 * A childless node of some registered kind.
 *
 * Imprecision, called out so nobody chases it: this maps over the WHOLE
 * registry, so it names a `container: false` variant even for kinds declared
 * `container: true`. `container` is kind-level but not a literal type on
 * `ConsumerDefinedNodeType`, so the tuple cannot be filtered on it. At runtime a container
 * kind never produces a `LeafNode`.
 */
export type LeafNode<Ts extends readonly WidenedNodeType[]> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer D, infer _E>
    ? Readonly<{
        id: NodeId;
        /** Discriminant #1 of `GraphNode`. See the note on `GraphNode`. */
        sealed: false;
        container: false;
        kind: K;
        data: D;
      }>
    : never;
}[number];

export type CollectionNode<Ts extends readonly WidenedNodeType[], S> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer D, infer _E>
    ? Readonly<{
        id: NodeId;
        sealed: false;
        container: true;
        kind: K;
        data: D;
        children: ChildrenState;
        /**
         * Present on EVERY collection, loaded or not — NOT only on
         * placeholders. Verified against the predecessor: a *loaded*
         * collection prefers its stored rollup in the uncertain case, so a
         * union that dropped this slot on load would delete the field that
         * rule needs and turn the write-back path into dead code.
         */
        summary: S | null;
      }>
    : never;
}[number];

/**
 * A migration that throws or returns garbage is reported as `"parse-failed"`
 * with an Issue at `$.schemaVersion` rather than earning a third reason — the
 * consumer-visible distinction that matters is "we could not build this", and
 * the Issue carries the detail.
 */
export type SealReason =
  | "unknown-kind"
  | "parse-failed"
  /**
   * The node's WIRE SHAPE disagrees with its registered kind: a leaf kind
   * arriving with a children array or a `childrenState`.
   *
   * This used to abort the WHOLE DOCUMENT — the one shape failure that still
   * did, while a node whose DATA failed to parse sealed and the document
   * loaded around it. The asymmetry was not deliberate; the comment two types
   * down already made the argument against it: "one refused stored clip made
   * a whole document unwritable forever."
   *
   * The node is held as a SEALD CONTAINER carrying the children it
   * declared, which is what keeps them from being orphaned — the one thing
   * this engine refuses to do. Repair it by fixing the kind's `container`
   * flag or the document, and it loads clean.
   */
  | "shape-mismatch";

/**
 * A node whose kind is unregistered, or whose parse failed.
 *
 * `raw` is the node's DATA only; its children stay in the flat tree, so
 * re-emit is byte-exact AND a child may still be moved out. Movable,
 * removable, undoable; NOT editable; poisons its ancestors' folds to
 * `"partial"`.
 *
 * Seal rather than rejection is the default because the alternative
 * shipped: one refused stored clip made a whole document unwritable forever,
 * and since the trash bin is rewritten on every delete, deleting *anything*
 * became impossible.
 *
 * `container` comes from the WIRE, not from a node type — there is no node type.
 */
export type SealedNode = Readonly<{
  id: NodeId;
  sealed: true;
  kind: string;
  container: boolean;
  schemaVersion: number;
  raw: unknown;
  reason: SealReason;
  issues: readonly Issue[];
  /**
   * A sealed CONTAINER still needs its load state, or a document that
   * round-trips through seal would forget that a subtree was unloaded.
   * `null` on a sealed leaf.
   */
  children: ChildrenState | null;
  /** Carried through untouched — the summary type is not the failing one. */
  summary: unknown;
}>;

/**
 * The read type — a node exactly as the graph holds it, in whichever of the
 * three shapes it turned out to have.
 *
 * CLOSED, not permissive, and the name matters because this used to be called
 * `AnyNode` in a package whose own rule is "never use `any`". Nothing here is
 * loose: this is the most CONSTRAINING type in the engine. `SealedNode` is
 * a member ON PURPOSE, so a consumer's exhaustive switch does not compile until
 * forward-incompatible data is handled.
 *
 * `GraphNode` rather than `Node` because @storyboard/graph-react and every
 * consumer app compile with `lib: ["dom", ...]`, where a bare `Node` export
 * would shadow the DOM one in exactly the files most likely to need both.
 * `PhantomTypes` still calls it `Node` — that one is reached as
 * `engine.types.Node`, so it is namespaced and can keep the better name.
 *
 * DISCRIMINATE ON `sealed` FIRST, THEN `container`:
 *
 *   if (node.sealed) { ... }        // SealedNode
 *   else if (node.container) { ... }     // CollectionNode
 *   else { ... }                         // LeafNode
 *
 * `container` alone cannot do it — it is `boolean` on the sealed arm (it
 * comes off the wire), so it is not disjoint from the literal `true` / `false`
 * on the other two. That is why `LeafNode` and `CollectionNode` carry an
 * explicit `sealed: false`.
 */
export type GraphNode<Ts extends readonly WidenedNodeType[], S> =
  | LeafNode<Ts>
  | CollectionNode<Ts, S>
  | SealedNode;

/**
 * The normalized graph — a pure value, replaced wholesale on every mutation.
 * Nothing here is mutated in place; `applyPatch` is the only code that
 * rewrites the indexes, so undo/redo cannot drift from forward application.
 */
export type Graph<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  /** Cross-instance guard. Checked on every mutating call and every ingress. */
  engineId: symbol;
  nodesById: ReadonlyMap<NodeId, GraphNode<Ts, S>>;
  /** EXACTLY the `loaded` collections — no other node has an entry. */
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Total over `nodesById`. `null` for a root. */
  parentById: ReadonlyMap<NodeId, NodeId | null>;
  rootIds: readonly NodeId[];
  /**
   * ONE mechanism doing two jobs: aggregate cache key AND render
   * subscription. Bumped along the affected ancestor chains by EVERY
   * mutation — hydration, `markMissing` and `applyNonUndoableWrite` included, even
   * though those produce no patch.
   *
   * This closes a hole measured in the predecessor: its per-parent data
   * version deliberately did not bump for moves, on the reasoning that
   * "structure changes already announce themselves through the children
   * array's identity". True for a direct child list, FALSE for an ancestor's
   * rollup — move a node at depth 5 and no ancestor's children array changes
   * identity, so no ancestor rollup ever re-renders.
   *
   * TOTAL OVER `nodesById` AND NOTHING MORE: every live node has an entry, and
   * no id without a node does. A removed id's revision moves to `deadRevById`
   * rather than staying here — see there for why it is kept at all, and why
   * keeping it HERE cost a long session real time.
   */
  subtreeRevById: ReadonlyMap<NodeId, number>;
  /**
   * The revision each REMOVED id last held. A tombstone store.
   *
   * WHY THESE ARE KEPT. `subtreeRevById` is the fold cache's only invalidation
   * mechanism: an entry keyed (foldKey, nodeId, rev) is meant to become
   * unreachable once the rev moves past it, which is why nothing ever evicts
   * for correctness. Forgetting a removed id's revision restarts a re-inserted
   * id at 0, and the store then serves the DEAD lineage's cached values — a
   * wrong AGGREGATE at the root that does not self-heal. That shipped twice.
   *
   * WHY THEY LIVE HERE RATHER THAN BESIDE THE LIVE ONES. They used to sit in
   * `subtreeRevById`, which made it a superset of `nodesById` and — the part
   * that cost — put them inside the map every commit copies. Growth is exactly
   * one entry per ever-removed id, for the life of the store, so per-commit
   * cost tracked the number of nodes a session had ever DELETED rather than the
   * number it currently holds. MEASURED on one `edit-nodes`: 40us at zero
   * tombstones, 1.7ms at 20,000, 29.4ms at 200,400 — and confirmed to be the
   * copy, since a bare `new Map` on the same map tracked it at ratio ~1.0.
   *
   * Split out, the semantics are byte-for-byte what they were — same numbers,
   * same high-water rule, no eviction and no threshold — and the copy every
   * commit makes is proportional to LIVE nodes again. This map has exactly one
   * writer (`applyRemoved`) and is shared by reference by every commit that
   * removes nothing, which is nearly all of them.
   *
   * NOT disjoint from `subtreeRevById`, and an earlier version of this comment
   * claimed it was — "an id is live or dead, never both", backed by "invariant
   * check 6 asserts the disjointness rather than trusting it." Both halves were
   * false. Check 6 requires every LIVE node to have a rev and never reads this
   * map at all, and the overlap is reachable by the most ordinary gesture there
   * is: remove a node, then undo. Measured through the public store —
   *
   *   after remove : live=false dead=true
   *   after undo   : live=true  dead=true
   *
   * — because `applyRemoved` writes the tombstone and `applyInserted` seeds the
   * returning id ABOVE it without clearing it, which is exactly what the
   * high-water rule requires.
   *
   * The overlap is INERT rather than merely tolerated: `getSubtreeRev` reads
   * `subtreeRevById` first and only falls through to this map for an id with no
   * live entry, so a stale dead number can never be the answer for a live node.
   * What it costs is one number per ever-removed id for the store's lifetime,
   * which is the trade `applyRemoved` argues for at length.
   *
   * Stated here as an observation rather than an assertion because nothing
   * checks it. If a future check wants to police this map, the property worth
   * asserting is the high-water rule — a tombstone sits strictly above every
   * rev its dead lineage cached — not disjointness, which is neither true nor
   * needed.
   */
  deadRevById: ReadonlyMap<NodeId, number>;
  /** Derived from `contentKey`. Values are in document order. */
  placementsByContentKey: ReadonlyMap<string, readonly NodeId[]>;
  /** Derived from `sourceKey`. At most one non-`reference` placement per key. */
  ownerBySourceKey: ReadonlyMap<string, NodeId>;
}>;
