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
 * `GraphNode` rather than `Node` because the React entry and every
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
   * no id without a node does. A removal DELETES the entry; what stops a
   * returning id from reusing a revision its dead lineage cached is `revFloor`,
   * not a per-id tombstone.
   *
   * NEVER ZERO FOR A LIVE NODE. Every seed starts at 1 and every bump adds 1,
   * so `0` is reserved to mean "this graph does not hold that node" — which is
   * what `getSubtreeRev` answers for an absent id, and what makes a removal
   * VISIBLE to the removed node's own subscribers without keeping anything
   * behind for them to compare against. Seeding at 0, as this did, made a
   * never-edited node read 0 both before and after its own removal.
   */
  subtreeRevById: ReadonlyMap<NodeId, number>;
  /**
   * A high-water mark: strictly greater than or equal to every revision this
   * lineage has ever issued, live or since deleted.
   *
   * WHAT IT REPLACED, and why one number instead of a map. `subtreeRevById` is
   * the fold cache's only invalidation mechanism — an entry keyed
   * (foldKey, nodeId, rev) becomes unreachable once the rev moves past it,
   * which is why nothing ever evicts for correctness. So a re-inserted id must
   * NOT restart below where it died, or the table serves the dead lineage's
   * values: a wrong aggregate at the root that does not self-heal. That has
   * shipped twice.
   *
   * The previous answer was a per-id tombstone store, `deadRevById`, holding
   * one entry for every id ever removed. It was correct and it was unbounded:
   * `applyRemoved` copied it whole on every removal, so a delete cost what the
   * SESSION had deleted rather than what the document held. MEASURED,
   * insert-then-remove one node in a loop with the live count pinned at 1 —
   * 0.045 ms per delete at 1,000 tombstones, 0.195 ms at 4,000, 0.478 ms at
   * 8,000, and D separate deletions copying D^2/2 entries in total.
   *
   * A FLOOR IS STRICTLY STRONGER THAN A TOMBSTONE. The rule a tombstone
   * enforced was "a returning id resumes above every rev IT ever had"; this
   * enforces "above every rev ANY node ever had", which implies it. One number,
   * O(1) to carry, and a removal now copies exactly what every other commit
   * copies.
   *
   * THE INVARIANT THIS TRADES FOR, stated plainly because it is the new way to
   * be wrong: every value in `subtreeRevById` must be <= `revFloor`. An arm that
   * bumps revisions and forgets to raise the floor lets a returning id collide
   * with a cached rev, silently, which is the exact failure the tombstones
   * existed to prevent. `bumpSubtreeRevsInto` returns the highest value it
   * wrote so a caller cannot compute it independently and drift, and invariant
   * check 10 in ./graph audits it — the tombstone store had no such check
   * because it needed none.
   */
  revFloor: number;
  /** Derived from `contentKey`. Values are in document order. */
  placementsByContentKey: ReadonlyMap<string, readonly NodeId[]>;
  /** Derived from `sourceKey`. At most one non-`reference` placement per key. */
  ownerBySourceKey: ReadonlyMap<string, NodeId>;
}>;
