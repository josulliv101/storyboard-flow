// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { Command, DropIntent, EditOf, Seed } from "./commands";
import type { FoldCacheStats, FoldRegistry, FoldValue, Folded } from "./folds";
import type { CollectionNode, Graph, GraphNode, LeafNode } from "./graph";
import type { History } from "./history";
import type { ConsumerDefinedSummaryType, KindOf, WidenedNodeType } from "./node-types";
import type { Patch } from "./patches";
import type { NodeId, Result } from "./primitives";
import type { LoadRejection, Rejection, ReplayRejection, StructuralError, Violation } from "./rejections";
import type { LoadReport, SerializedDocument } from "./wire";

// ---------------------------------------------------------------------------
// 10. Engine and Store
// ---------------------------------------------------------------------------

/**
 * What the persistence feed sees. `applyNonUndoableWrite`, `loadChildren` and
 * `markMissing` emit NOTHING here — they are IO landing, and the consumer
 * already knows about the write it just performed.
 */
export type Change<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  patch: Patch<Ts, S>;
  source: "command" | "undo" | "redo";
  /**
   * Removed containers whose subtrees were not loaded, so the consumer can
   * defer the hard delete instead of orphaning storage it never read.
   */
  detachedSubtrees: readonly NodeId[];
  at: number;
}>;

/**
 * A SEPARATE subscription slice. Never in the graph, never in a patch, never
 * undoable — but engine-owned all the same, because range-select needs
 * document order and removal must prune it. A selection change must NOT notify
 * graph subscribers.
 */
export type SelectionSlice = Readonly<{
  get(): readonly NodeId[];
  has(id: NodeId): boolean;
  set(ids: readonly NodeId[]): void;
  toggle(id: NodeId): void;
  clear(): void;
  /** Inclusive, in DOCUMENT order — which is why this lives beside the graph. */
  selectRange(anchorId: NodeId, toId: NodeId): void;
  anchor(): NodeId | null;
  subscribe(listener: () => void): () => void;
}>;

export type Store<
  Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  getGraph(): Graph<Ts, S>;
  /** Fires when that node's `subtreeRev` changes — a primitive, so a selector
   *  store can compare it without touching the node. */
  subscribeToNode(id: NodeId, listener: () => void): () => void;
  subscribeToGraph(listener: () => void): () => void;
  /** The persistence feed. */
  subscribeToChanges(listener: (change: Change<Ts, S>) => void): () => void;
  dispatch(
    command: Command<Ts, S>,
    options?: Readonly<{ coalesceKey?: string }>,
  ): Result<Patch<Ts, S>, Rejection>;
  resolveDrop(intent: DropIntent<Ts, S>): Result<Command<Ts, S>, Rejection>;
  undo(): Result<Patch<Ts, S>, ReplayRejection>;
  redo(): Result<Patch<Ts, S>, ReplayRejection>;
  canUndo(): boolean;
  canRedo(): boolean;
  /**
   * Drop the undo stack. THE ONLY RECOVERY from a dormant entry whose world
   * moved, and until it existed there was none.
   *
   * `undo()` deliberately leaves the stack untouched when replay is refused, so
   * a rejection does not destroy the entry — but entries replay in order, so
   * one permanently inapplicable entry makes everything beneath it unreachable
   * too. Reachable through `applyNonUndoableWrite`, which is a NON-undoable
   * write: it can move a live node onto a `sourceKey` a sleeping patch still
   * carries, and the replay then refuses with `"duplicate-owner"` forever while
   * `canUndo()` keeps answering true. The button stays lit and does nothing for
   * the rest of the session.
   *
   * ./history has exported `clearPast` since it was written and documented it
   * as exactly this recovery; nothing could reach it, because the engine holds
   * `History` in a closure and no accessor returned one. The pure function is
   * still there for a consumer composing history values directly.
   */
  clearPast(): void;
  /** Drop the redo branch, keeping the undo stack. */
  clearFuture(): void;
  /** Both stacks. The document is untouched — this forgets how it got here. */
  clearHistory(): void;
  /** The non-undoable content write. Returns the ids whose history was scrubbed. */
  applyNonUndoableWrite(edits: readonly EditOf<Ts>[]): Result<readonly NodeId[], Rejection>;
  /** `unknown` for the reason `Engine.loadChildren` gives: the payload came from
   *  IO and is re-validated here, so the signature must not vouch for it. Pass a
   *  `SerializedDocument`; a structural failure returns `"malformed-document"`.
   *
   *  Returns the `LoadReport`, because `ok: true` is not the same as "every node
   *  arrived intact" — sealing is a success path. This used to be
   *  `Result<void>` while the report was computed and discarded one call below,
   *  so a page in which every single node sealed looked exactly like a
   *  clean one. Check `report.sealed` before telling the user the folder
   *  loaded. */
  load(id: NodeId, doc: unknown): Result<LoadReport, LoadRejection>;
  markMissing(id: NodeId, reason: string): void;
  /** `undefined` when the node is gone — routine in React, where a card can
   *  outlive its node by a frame. */
  aggregate<K extends keyof F>(
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;
  selection: SelectionSlice;
  destroy(): void;
}>;

/**
 * `undefined as never` at runtime — these exist so a consumer can write
 * `typeof engine.types.Node` instead of restating the registry tuple. Reading
 * one at runtime yields `undefined`; nothing should.
 */
export type PhantomTypes<
  Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  /**
   * `Node`, not `GraphNode`, and the difference is deliberate rather than
   * drift. This map is reached as `engine.types.Node`, so it is namespaced and
   * cannot collide with DOM's `Node` — which is exactly why the exported type
   * carries the longer name and this one does not. See `GraphNode`.
   */
  Node: GraphNode<Ts, S>;
  Leaf: LeafNode<Ts>;
  Collection: CollectionNode<Ts, S>;
  Graph: Graph<Ts, S>;
  Command: Command<Ts, S>;
  Patch: Patch<Ts, S>;
  Edit: EditOf<Ts>;
  Seed: Seed<Ts, S>;
  Intent: DropIntent<Ts, S>;
  History: History<Ts, S>;
  Store: Store<Ts, S, F>;
  Summary: S;
  Kind: KindOf<Ts>;
  /**
   * The fold registry itself, and it is LOAD-BEARING rather than one more
   * convenience alias.
   *
   * `Engine` is a type ALIAS, so it is structurally expanded when TypeScript
   * infers against it — and everywhere else in `Engine` (and in `Store`, and in
   * the rest of this object) `F` appears only as `keyof F` or `F[K]`, which are
   * NON-INFERRABLE positions. Without one direct occurrence somewhere,
   * `createReactBindings(engine)` finds no candidate for `F` at all and falls
   * back to its constraint, at which point `keyof F` collapses to `string`,
   * `FoldValue<F[K]>` collapses to `unknown`, and every `useFold("duration", id)`
   * in every consumer returns `Folded<unknown>` — silently, with no error at the
   * definition site. `createEngine` is unaffected because it infers `F` from
   * `EngineConfig.folds`, which is a direct position; only downstream factories
   * taking a finished `Engine` are hit.
   *
   * This one property is that direct occurrence. Verified by compiling both.
   */
  Folds: F;
}>;

/**
 * `createEngine`'s tuple guard, intersected onto its `config` parameter.
 *
 * `Ts` is the compile-time half of the kind-to-`Data` correspondence: the TUPLE
 * is what remembers that `"clip"` means `Data = Clip`. A plain array has no
 * per-position types, so every mapped type built on `Ts` — `EditOf`,
 * `DataForKind`, `KindOf`, `Seed` — collapses from a discriminated union into a
 * cross-product, and a folder's edit under `kind: "clip"` typechecks.
 *
 * MEASURED, the same wrong-kind edit through `store.dispatch`:
 *
 *   types: [clipType, folderType] as const   ->  error, correctly
 *   types: [clipType, folderType]            ->  COMPILED CLEAN
 *
 * `createEngine`'s `const Ts` already rescues an inline literal, so the hole is
 * the named variable declared without `as const` — which is how anyone with
 * more than two node types writes it.
 *
 * A tuple's `length` is a literal (`2`); an array's is `number`, so
 * `number extends Ts["length"]` is true only for the array. It then resolves to
 * a type whose NAME is the fix, and the consumer reads the instruction in the
 * error rather than getting a silently weaker engine.
 *
 * INTERSECTED at the call door rather than declared on `EngineConfig.types`,
 * for a reason worth keeping: `config.types` stays assignable to `Ts` inside
 * the function body, because an intersection is assignable to each of its
 * members. Putting the conditional on the property instead made
 * `buildRegistry(config.types)` stop compiling and would have bought a fifth
 * sanctioned cast to fix — a real cost for the same diagnostic.
 */
export type RequireTupleTypes<Ts extends readonly WidenedNodeType[]> =
  number extends Ts["length"]
    ? {
        types: "graph-core: `types` must be a TUPLE, not an array — add `as const`. Without it every per-kind type collapses and a wrong-kind edit compiles.";
      }
    : unknown;

export type EngineConfig<
  Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  /**
   * Duplicate `kind` is REJECTED at runtime — it THROWS, because a duplicate
   * is a programmer error at module init, not a recoverable condition. Two
   * node types claiming one kind means one silently wins at the trust boundary
   * and the discriminant is dead.
   *
   * MUST BE A TUPLE, and this type enforces it rather than trusting it. `Ts` is
   * the compile-time half of the kind-to-`Data` correspondence: the tuple is
   * what remembers that `"clip"` means `Data = Clip`. A plain ARRAY has no
   * per-position types, so every mapped type built on `Ts` — `EditOf`,
   * `DataForKind`, `KindOf`, `Seed` — collapses from a discriminated union to a
   * cross-product, and a folder's edit under `kind: "clip"` typechecks.
   *
   * MEASURED, the same wrong-kind edit through `store.dispatch`:
   *
   *   types: [clipType, folderType] as const   ->  error, correctly
   *   types: [clipType, folderType]            ->  COMPILED CLEAN
   *
   * `createEngine`'s `const Ts` already rescues an inline literal, so the hole
   * is the named variable declared without `as const` — which is how anyone
   * with more than two node types writes it.
   *
   * THE GUARD LIVES ON `createEngine`, not here — see `RequireTupleTypes`. This
   * type keeps saying `Ts`, honestly, because that is what a config holds once
   * it exists; the door is where the mistake is made and where it is worth
   * refusing.
   */
  types: Ts;
  summary: ConsumerDefinedSummaryType<S>;
  folds: F;
  /** Default `"seal"`. */
  onUnknownKind?: "seal" | "reject";
  /** Default `"seal"`. */
  onParseFailure?: "seal" | "reject";
  /**
   * PRE-commit veto — it stops the pipeline before anything is pushed. A
   * post-commit veto corrupts redo: the push clears the redo branch, then the
   * subsequent undo pushes the REFUSED command onto it.
   */
  commandPolicy?(command: Command<Ts, S>, graph: Graph<Ts, S>): Rejection | null;
  mintId?(): string;
  /** Injectable so tests get deterministic `HistoryEntry.at`. Defaults to `Date.now`. */
  now?(): number;
  historyLimit?: number;
  /**
   * Ceiling on how many nodes ONE document may present to `deserialize`.
   * Defaults to `DEFAULT_MAX_NODES`.
   *
   * A payload arrives from storage or from the wire, which makes its size
   * hostile input rather than a known quantity, and every pass below builds
   * maps sized by it. Unbounded, a single malformed or malicious document
   * decides how much memory this process allocates.
   *
   * REFUSES, never truncates. A document half-loaded is a document with
   * silently missing children, and the whole point of the four-state
   * `ChildrenState` is that "we have not looked" is a state the engine can
   * name — a truncating loader would produce collections that claim to be
   * `loaded` and are not, which is the exact ambiguity that cost the
   * predecessor 40-second duration errors.
   */
  maxNodes?: number;
  /**
   * Live-node count past which each store warns ONCE that its commits no
   * longer fit an interactive frame. Defaults to
   * `DEFAULT_INTERACTIVE_NODE_BUDGET`; `0` silences it.
   *
   * NOT A CEILING, and specifically not `maxNodes` by another name. `maxNodes`
   * is a trust boundary on one incoming payload — it refuses hostile input so a
   * document cannot decide this process's memory. This is a property of ANY
   * graph however it got that big, including one that loaded at 900 nodes and
   * grew past the budget an insert at a time, which no load-time check can see.
   *
   * Set it when you know your documents are large and you have accepted what a
   * commit costs there — the number in `DEFAULT_INTERACTIVE_NODE_BUDGET` is
   * measured, not guessed, and a consumer who names their own has named THE
   * budget. Setting `0` is the same statement, said louder.
   */
  interactiveNodeBudget?: number;
  /**
   * Ceiling on nesting depth. Defaults to UNBOUNDED, deliberately.
   *
   * Depth is not a correctness risk here and a default would be a fiction:
   * every walk in this package uses an explicit stack, and the performance
   * suite loads, folds, moves, undoes and redoes a 10,000-level chain without
   * overflowing. What depth costs is ancestor-chain work, which is linear in
   * it — a real cost, but the consumer's to price, not this package's to
   * guess. Set it when your shape has a known ceiling and a deeper document
   * means corrupt data rather than unusual data.
   */
  maxDepth?: number;
  /**
   * Ceiling on the LENGTH of one node id. Defaults to
   * `DEFAULT_MAX_NODE_ID_LENGTH`; `null` is unbounded.
   *
   * THE THIRD CEILING, and unlike `maxDepth` it ships with a number, for
   * `maxNodes`' reason: it can be defended without knowing your data, because
   * no legitimate id is within an order of magnitude of it. `maxNodes` bounds
   * how many nodes a document holds and `maxDepth` how deeply they nest;
   * neither bounds how large ONE of them is, and `tryParseNodeId` refuses only
   * the empty and whitespace-only string — so id size was the sender's to
   * choose under ceilings that read as complete.
   *
   * It is the memo table this protects, not the graph. The graph's maps key by
   * the id and a JavaScript string is shared by reference, so four maps cost
   * four pointers. `cacheKey` in ./folds CONCATENATES the id into a fresh
   * string per `(foldKey, nodeId, subtreeRev)` entry, and `foldCacheLimit`
   * bounds that table by ENTRY COUNT — so before this ceiling, the document
   * chose the per-entry size and ./folds' measured ~232 bytes an entry rested
   * on an assumption nothing enforced.
   *
   * ENFORCED AT INGRESS AND AT MINTING BOTH, which is the part worth knowing.
   * A ceiling applied only to documents would let `insert-nodes` put an id in
   * the graph that `deserialize` then refuses — the "saves cleanly, will not
   * load" shape this package has already paid for twice. So `mintFreshId`
   * treats an over-long id from a consumer `mintId` exactly as it treats a
   * whitespace one: not acceptable, retry, then fall back.
   */
  maxNodeIdLength?: number | null;
  /**
   * Ceiling on EACH STORE's fold memo table. Defaults to
   * `DEFAULT_FOLD_CACHE_LIMIT`.
   *
   * The number that matters is `registered folds x nodes folded over`, not a
   * round one: `computeFold` commits an entry per node it walks, and every fold
   * in the registry shares its store's single cache. Below that product the LRU
   * inverts — the last fold's walk evicts the first fold's entries, and every
   * mounted card refolds its subtree from scratch, which is the un-memoized
   * behaviour the table exists to beat. Raise this when `onFoldCacheStats`
   * shows evictions climbing while hits do not.
   *
   * `0` or less disables memoization entirely (every write is a no-op) — what a
   * shadow-refold check that must not be answered from cache wants. Non-finite
   * falls back to the default rather than growing without bound.
   *
   * Safe to expose at all only because the cache key carries `subtreeRev`: an
   * evicted entry costs a recomputation and can never change an answer.
   */
  foldCacheLimit?: number;
  /**
   * Called ONCE per `createStore`, synchronously, with a reader for THAT
   * store's cache counters.
   *
   * Per store because the caches are per store — two divergent lineages must
   * never share one — so there is no engine-wide number to hand out instead.
   *
   * A reader, not the cache: a consumer that could WRITE to the table is the
   * one way to make a rev-keyed slot wrong rather than merely stale, and
   * observability does not need that power. It exists because a memo table that
   * has silently stopped helping is indistinguishable from one that never
   * helped — same answers, more work — so an undersized `foldCacheLimit` has no
   * other symptom.
   *
   * Takes `FoldCacheStats` — the type declared above, which ./folds imports —
   * rather than a hand-copy of its shape. The copy was here on the argument
   * that importing it from ./folds would be a cycle; true, and beside the
   * point, since the type can simply live in the module that has no imports.
   */
  onFoldCacheStats?(readStats: () => FoldCacheStats): void;
  devChecks?: boolean;
}>;

export type Engine<
  Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  engineId: symbol;

  // ---- untrusted doors: every one runs migrations, then parse ----
  deserialize(
    raw: unknown,
  ): Result<
    Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
    StructuralError
  >;
  serialize(graph: Graph<Ts, S>): SerializedDocument;

  /**
   * `serialize`, refusing a graph that would not load back.
   *
   * THE FAILURE THIS EXISTS FOR is one this engine has actually produced: a
   * cyclic move patch detached a document from every root, `serializeGraph`
   * wrote all of it — it emits unreachable nodes deliberately rather than
   * dropping them, because dropping is the worse loss — and `deserialize` then
   * refused that file FOREVER with `unreachable-node`. The write succeeded and
   * the document was gone.
   *
   * `serialize` stays TOTAL and unchanged. It has to: "a save path that throws
   * loses the user's document" is its own contract, and a save that refuses is
   * a save that did not happen. This is the door for a caller who would rather
   * hear about a broken graph BEFORE writing it somewhere, and it hands back
   * the violation instead of the bytes so that decision is theirs.
   *
   *   const written = engine.serializeChecked(store.getGraph());
   *   if (!written.ok) return reportCorruption(written.error);
   *   await storage.put(written.value);
   *
   * BLOCK, DO NOT WRITE — the decided default, and the reason is worth keeping
   * next to the door. When this refuses, the PREVIOUSLY saved document is still
   * loadable; the one in memory is not. Writing anyway trades a good file for a
   * dead one. Blocking costs the unsaved edits; saving costs the document.
   *
   * THE ALERT IS THE CONSUMER'S, and not by omission. This package has no React
   * and no DOM below `./index` — that separation is what lets a route handler
   * call `deserialize` without importing a client module — so nothing here can
   * or should reach a user. What it owes the consumer instead is a violation
   * worth acting on: `code` to branch on, `nodeId` to name the item in the
   * consumer's own vocabulary. `message` is written for a developer and belongs
   * in a log, not in front of a user.
   *
   * A REPAIR PATH, if one is ever wanted, is additive and needs nothing here:
   * a separate `repair(graph)` door returning a corrected `Graph`, and the flow
   * becomes refuse -> repair -> retry. Recorded so that adopting block-and-alert
   * now is not a decision that has to be unpicked later.
   *
   * WHY SAVE AND NOT EVERY COMMIT. The audit is a full pass — reachability,
   * one `sourceKey` call per node, and a complete rebuild of both derived
   * indexes to compare. MEASURED against a single `edit-nodes` on the same
   * graph:
   *
   *     10,501 nodes   commit  3.00 ms   audit   9.18 ms   3.1x
   *     26,251 nodes   commit  6.05 ms   audit  21.05 ms   3.5x
   *     52,501 nodes   commit 12.89 ms   audit  53.62 ms   4.2x
   *
   * Per keystroke that is a frame gone at the size `DEFAULT_INTERACTIVE_NODE_BUDGET`
   * already calls expensive, and the multiple GROWS with the document. Per
   * save it is 53 ms once, against a corruption that is otherwise permanent —
   * which is the trade `EngineConfig.devChecks` cannot make, because it is off
   * in production and this is exactly where production needs it.
   *
   * Not free and not automatic: `serialize` remains the default, and a consumer
   * saving on every keystroke should keep using it.
   */
  serializeChecked(
    graph: Graph<Ts, S>,
  ): Result<SerializedDocument, Violation>;

  // ---- the pure core ----
  applyCommand(
    graph: Graph<Ts, S>,
    command: Command<Ts, S>,
  ): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection>;
  /**
   * THE ONE index rewriter — forward application and undo share it.
   *
   * PRECONDITION: `verifyPatchApplies` returned ok for THIS graph and THIS
   * patch. This function re-checks nothing, and that is deliberate — re-checking
   * would either duplicate the gate and drift from it, or tempt a caller to skip
   * the gate because "apply validates anyway", which is how the dormant-patch
   * corruptions happened in the first place.
   *
   * SO IT IS UNSAFE ON ITS OWN, and the signature cannot say so: it returns a
   * `Graph`, not a `Result`, because with the precondition met there is nothing
   * to reject. That reads as total, and this paragraph is the only thing
   * standing between that reading and a silently corrupt graph. MEASURED, undo
   * of an insert whose node has since gained a child — the exact case
   * `verifyPatchApplies` answers `node-not-empty` for:
   *
   *     verifyPatchApplies  ->  node-not-empty
   *     applyPatch          ->  did not throw, returned a graph
   *     nodes               ->  3 before, 2 after, the child orphaned
   *     findInvariantViolation -> parent-index-disagrees
   *
   * Nothing rejects, nothing throws, and `serializeGraph` then writes the
   * result — it emits unreachable nodes rather than dropping them — so the
   * document saves cleanly and `deserialize` refuses it afterwards.
   *
   * USE `applyPatchChecked` UNLESS YOU HAVE ALREADY VERIFIED. This door stays
   * for the caller who verified once and applies to the same graph, and for the
   * reducer's own arms, which establish their preconditions by planning rather
   * than by replay.
   */
  applyPatch(graph: Graph<Ts, S>, patch: Patch<Ts, S>): Graph<Ts, S>;
  /**
   * `verifyPatchApplies` and then `applyPatch`, in that order, as one call.
   *
   * The same pairing `serializeChecked` makes with `findInvariantViolation`, and
   * added for the same reason: the two-step version is correct and the one-step
   * version is what a caller reaches for, so the safe order should be the one
   * that is easy to write. `undo` and `redo` have always done exactly this
   * internally; a consumer driving its own replay — which is why `applyPatch`,
   * `invertPatch` and `verifyPatchApplies` are exported as peers at all — had to
   * reassemble it from the parts and could silently omit the gate.
   *
   * Costs what verification costs, which is O(patch) rather than O(graph): the
   * gate reads the nodes the patch names, not the document. That is a different
   * trade from `serializeChecked`, whose audit is a full pass — so there is no
   * "keep using the unchecked one for speed" caveat here.
   */
  applyPatchChecked(
    graph: Graph<Ts, S>,
    patch: Patch<Ts, S>,
  ): Result<Graph<Ts, S>, ReplayRejection>;
  invertPatch(patch: Patch<Ts, S>): Patch<Ts, S>;
  verifyPatchApplies(
    graph: Graph<Ts, S>,
    patch: Patch<Ts, S>,
  ): Result<void, ReplayRejection>;
  findInvariantViolation(graph: Graph<Ts, S>): Violation | null;
  /** THE ONLY place a post-removal insertion index is computed. */
  resolveDrop(
    graph: Graph<Ts, S>,
    intent: DropIntent<Ts, S>,
  ): Result<Command<Ts, S>, Rejection>;

  // ---- IO landing: no patch, no history entry, no change-feed event ----
  /**
   * `doc` is `unknown`, matching `deserialize`, because it is the same kind of
   * value: a payload that arrived from IO and has been validated by nobody.
   *
   * It used to say `SerializedDocument`, which was a promise this signature
   * could not keep — the implementation has always taken `unknown` and
   * re-validated, and the comment there said so outright: "the consumer's
   * assertion, not a guarantee". A type that vouches for an unchecked envelope
   * invites a cast to stand in for a check, on the one door hostile payloads
   * arrive through.
   *
   * Pass a `SerializedDocument` — that is the shape this reads. It is simply
   * checked rather than believed, and a structural failure comes back as
   * `"malformed-document"` with the underlying `StructuralError` as `cause`.
   */
  loadChildren(
    graph: Graph<Ts, S>,
    id: NodeId,
    doc: unknown,
  ): Result<
    // Shaped like `deserialize`'s result, and for the same reason it has one:
    // sealing is a SUCCESS path, so `ok: true` alone does not mean every
    // node arrived intact. This door used to return the bare graph and drop the
    // report `buildDocument` had already computed, which made a lazy page where
    // every node sealed indistinguishable from a clean one.
    Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
    LoadRejection
  >;
  markMissing(graph: Graph<Ts, S>, id: NodeId, reason: string): Graph<Ts, S>;
  /**
   * THE NON-UNDOABLE CONTENT WRITE — the door no competing design had, and the
   * reason "one data field, no side table" survives contact with a real
   * consumer. Roughly half the fields on a realistic item have a writer that is
   * not user intent (a thumbnail arriving, a server stamping provenance). If
   * the only door into `data` is a command, then either Ctrl-Z undoes a
   * thumbnail, or a dormant whole-value `before` silently clobbers a server
   * write.
   *
   * It SCRUBS the history: for every written id, that node's entry is removed
   * from every `data-changed` patch in BOTH stacks, and the captured `data` for
   * that node is rewritten inside every dormant `inserted` / `removed`
   * placement. Content changes are per-node independent within a patch, so
   * surgical removal leaves every other change perfectly invertible. Structural
   * patches are untouched.
   *
   * The user loses undo of THEIR OWN edit to that one node — correct, the
   * server has since overwritten it — and keeps everything else. No clobber, no
   * stack truncation, no version mismatch that nukes the whole history.
   */
  applyNonUndoableWrite(
    graph: Graph<Ts, S>,
    history: History<Ts, S>,
    edits: readonly EditOf<Ts>[],
  ): Result<
    Readonly<{
      graph: Graph<Ts, S>;
      history: History<Ts, S>;
      scrubbed: readonly NodeId[];
    }>,
    Rejection
  >;

  aggregate<K extends keyof F>(
    graph: Graph<Ts, S>,
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;
  createStore(graph: Graph<Ts, S>): Store<Ts, S, F>;
  types: PhantomTypes<Ts, S, F>;
}>;
