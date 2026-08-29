// KEEL — the assembled engine surface, and the store that owns a live graph.
//
// PURE. No React, no DOM, no "use client". `createEngine` has to stay callable
// from a route handler: the moment the factory that produces `deserialize` also
// produces a Provider, `export const engine = createEngine(...)` lands in a
// `"use client"` module, a server route imports it, it typechecks clean, and it
// 500s at request time. That is why the React bindings are a separate package
// that takes a finished engine.
//
// This module contains no logic of its own beyond assembly. Every rule lives in
// the module that owns it — the reducer in ./commands, index rewriting in
// ./patches, the trust boundary in ./serialize — and the two things assembled
// here are the ones that genuinely have nowhere else to live:
//
//   1. `commandPolicy`, which must run PRE-commit and is deliberately not on
//      `EngineContext` (so ./commands cannot run it late);
//   2. the store, which is the only stateful thing in keel-core.

import type {
  Change,
  Command,
  Engine,
  EngineConfig,
  EngineContext,
  FoldCache,
  Folded,
  FoldRegistry,
  FoldValue,
  Graph,
  History,
  NodeId,
  Patch,
  Rejection,
  ReplayRejection,
  Result,
  SelectionSlice,
  SomeFold,
  SomeNodeType,
  Store,
} from "./types";
import { makeFolded } from "./types";
import {
  buildRegistry,
  documentOrder,
  findInvariantViolation as findInvariantViolationIn,
  getNode,
  getSubtreeRev,
  markMissing as markMissingIn,
} from "./graph";
import {
  applyPatch as applyPatchTo,
  invertPatch as invertPatchOf,
  patchDetachedSubtrees,
  verifyPatchApplies as verifyPatchAppliesTo,
} from "./patches";
import {
  applyCommand as applyCommandTo,
  applyIngestEdits,
  resolveDrop as resolveDropIn,
} from "./commands";
import { computeFold, createFoldCache } from "./folds";
import {
  DEFAULT_MAX_NODES,
  deserializeDocument,
  loadChildrenInto,
  serializeGraph,
} from "./serialize";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commitRedo,
  commitUndo,
  createHistory,
  peekRedo,
  peekUndo,
  pushHistory,
} from "./history";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Process-wide, not per-engine, and that is the point: `Math.random` alone can
 * repeat, and the reducer's collision check only sees ids already IN the graph
 * — a freshly minted sibling in the same `insert-nodes` batch is not there yet.
 * A monotonic counter makes an intra-process collision impossible regardless of
 * what `Math.random` does.
 *
 * Deliberately not `crypto.randomUUID`: this module must load in a Node route
 * handler, a browser bundle and a bare vitest node environment, and the three
 * disagree about where that global lives.
 */
let mintCounter = 0;

/**
 * Computed ONCE per module instance, which is what makes it worth having: the
 * counter above rules out an intra-process collision, and this rules out a
 * cross-process one. Two workers, two tabs, or a server and a client minting
 * ids for the same document each get a different prefix, so their ids cannot
 * meet in the middle when the documents merge.
 *
 * `crypto` is FEATURE-DETECTED rather than assumed. This module must load in a
 * Node route handler, a browser bundle and a bare vitest node environment, and
 * they have historically disagreed about where that global lives — so the
 * fallback is the same `Math.random` this used before, and the detection can
 * only improve on it.
 */
const mintPrefix: string = (() => {
  // Structurally typed, not `Crypto` — this package's `lib` is `esnext` with no
  // DOM, which is the very portability the paragraph above is about. Naming the
  // DOM type here would break the build it is meant to protect.
  const host: Readonly<Record<string, unknown>> =
    globalThis as unknown as Readonly<Record<string, unknown>>;
  const c = host["crypto"];
  if (typeof c === "object" && c !== null) {
    const uuid = (c as Readonly<Record<string, unknown>>)["randomUUID"];
    if (typeof uuid === "function") {
      const value: unknown = (uuid as () => unknown).call(c);
      if (typeof value === "string" && value.length >= 8) return value.slice(0, 8);
    }
  }
  return Math.random().toString(36).slice(2, 10);
})();

function defaultMintId(): string {
  mintCounter += 1;
  return `keel-${mintPrefix}-${mintCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * How much room over `folds x nodes` a fold cache needs to stop thrashing.
 *
 * The product is the working set's FLOOR. Editing strands `folds x depth`
 * entries per edit, and those strays are newer than a cold live entry, so a
 * table sized exactly to the product evicts something live for every one of
 * them. Measured against the ideal fold-call count per post-edit root read:
 * 1.90x ideal at 1x the product, 1.27x at 2x, 1.00x at 4x. Two is the knee —
 * enough to stop the inversion, not so much that the recommendation reads as
 * absurd for a large board.
 */
const FOLD_CACHE_HEADROOM = 2;

/**
 * Live-node count past which ONE commit stops fitting an interactive frame.
 *
 * WHY THERE IS A NUMBER HERE AT ALL. A commit copies whole maps: every
 * mutation copies `subtreeRevById` (in `bumpSubtreeRevs`), a data change also
 * copies `nodesById` (in `applyDataChanged`), and an insert or a removal copies
 * four maps rather than two. So commit cost is proportional to how many nodes
 * the document HOLDS and not at all to how small the edit was — one keystroke
 * on one title pays for the whole graph.
 *
 * MEASURED, one `edit-nodes` and one `insert-nodes`, best-of-25, product-shaped
 * fixture (root -> folders of 20 clips):
 *
 *    10,025 nodes   edit  1.21 ms   insert  2.33 ms   0.120 us/node
 *    25,025 nodes   edit  3.26 ms   insert  6.28 ms   0.130 us/node
 *    50,025 nodes   edit  7.59 ms   insert 14.92 ms   0.152 us/node
 *   100,025 nodes   edit 17.06 ms   insert 33.89 ms   0.171 us/node
 *
 * Two things in that table decide this number. The per-node cost RISES with
 * size — 42% worse at 100,000 than at 10,000, as allocation and GC stop being
 * free — so extrapolating the small sizes linearly UNDERSTATES what a large
 * document costs. And `DEFAULT_MAX_NODES` is 100,000, where a single keystroke
 * costs 17 ms: a whole 60Hz frame inside the reducer, before React is asked to
 * render anything. The engine's own default admits documents it cannot serve
 * interactively.
 *
 * 25,000 is where the worst common gesture — an insert, which copies four maps
 * — still costs 6.3 ms, about a third of a frame, leaving the rest for render.
 * Above it the curve bends the wrong way.
 *
 * A DIAGNOSTIC, NOT A GATE, and deliberately not a lowered `maxNodes`. That
 * ceiling is a TRUST boundary: it exists so a hostile payload cannot decide how
 * much memory this process allocates, and lowering it to serve a performance
 * argument would refuse honest documents for the wrong reason. The two numbers
 * answer different questions and both should be sayable — which is the same
 * mistake, in the other direction, that #585 found between `maxNodes` and
 * `foldCacheLimit`. This one is audible instead of enforced.
 */
export const DEFAULT_INTERACTIVE_NODE_BUDGET = 25_000;

const noop = (): void => {};

function sameIds(a: readonly NodeId[], b: readonly NodeId[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/**
 * `ReplayRejectionCode` has no member for "the stack is empty", because every
 * member describes a DORMANT PATCH that no longer applies and an empty stack
 * has no patch at all. Rather than widen a vocabulary a parallel implementation
 * is also compiling against, this reuses the nearest member and says exactly
 * what happened in the message. `canUndo()` / `canRedo()` are the sanctioned
 * pre-checks; a consumer that asks first never sees this.
 */
function nothingToReplay(direction: "undo" | "redo"): ReplayRejection {
  const stack = direction === "undo" ? "past" : "future";
  return {
    code: "node-missing",
    message: `Nothing to ${direction}: the ${stack} stack is empty.`,
  };
}

// ---------------------------------------------------------------------------
// createEngine
// ---------------------------------------------------------------------------

/**
 * Build the engine. THROWS on a duplicate `kind` (via `buildRegistry`) and on a
 * duplicate fold `key`, and on nothing else, ever — both are programmer errors
 * at module init, before any data has been read, and there is no
 * partial-success answer worth returning when the consumer's own module graph
 * is wrong. Everything that can go wrong once DATA is involved returns a
 * `Result` instead.
 *
 * Defaults: `onUnknownKind` and `onParseFailure` quarantine, `mintId` a
 * counter-plus-random id, `now` `Date.now`, `historyLimit` unbounded,
 * `foldCacheLimit` `DEFAULT_FOLD_CACHE_LIMIT` (a folds x nodes product — see
 * ./folds), `devChecks` off.
 */
export function createEngine<
  const Ts extends readonly SomeNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
>(config: EngineConfig<Ts, S, F>): Engine<Ts, S, F> {
  const registry = buildRegistry(config.types);

  // Fold keys must be unique, and this is the check `readCachedFold` in
  // ./folds names as living here.
  //
  // Its cast from the cache's `unknown` slot is sound ONLY because the slot was
  // written under this same `fold.key`, so the value is that fold's `A`. Two
  // folds sharing a key share cache slots, and a `Folded<number>` then comes
  // back typed as whatever the other fold declared. Nothing else would notice:
  // the registry is keyed by the RECORD key, which may differ from the fold's
  // own `.key`, so a duplicate is invisible at the call site and produces a
  // wrong-typed value rather than an error.
  //
  // THROWS, like `buildRegistry`'s duplicate kind, for the same reason: it is a
  // programmer error at module init, before any data has been read, and there
  // is no partial-success answer worth returning.
  const foldKeyOwners = new Map<string, string>();
  for (const [entryKey, fold] of Object.entries(config.folds)) {
    const prior = foldKeyOwners.get(fold.key);
    if (prior !== undefined) {
      throw new Error(
        `keel: duplicate fold key ${JSON.stringify(fold.key)} — registered as ` +
          `both ${JSON.stringify(prior)} and ${JSON.stringify(entryKey)}. Fold ` +
          `keys are cache keys; two folds sharing one would read each other's ` +
          `cached values.`,
      );
    }
    foldKeyOwners.set(fold.key, entryKey);
  }

  // `historyLimit` REFUSED rather than reinterpreted, and this is the one place
  // that can. ./history's `effectiveLimit` maps anything that is not a positive
  // integer — `0`, a negative, a fraction, `NaN` — to unbounded, and argues for
  // it on the grounds that `historyLimit: 2.5` is a typo and silently choosing
  // 2 or 3 would hide it. True, and choosing INFINITY hides it too, in the one
  // direction that is unsafe: the consumer asked to bound memory and got no
  // bound. MEASURED: `historyLimit: 2.5` retained 200 entries.
  //
  // Throws, like the duplicate kind and the duplicate fold key above, for the
  // same reason — a programmer error at module init, before any data has been
  // read. Omitting the field is still how a consumer asks for unbounded, and
  // that stays silent.
  const historyLimit = config.historyLimit;
  if (
    historyLimit !== undefined &&
    (!Number.isInteger(historyLimit) || historyLimit <= 0)
  ) {
    throw new Error(
      `keel: historyLimit must be a positive integer, received ${String(historyLimit)}. ` +
        `Omit it entirely for unbounded history — a fractional or non-positive value ` +
        `would silently mean unbounded, which is the opposite of what naming a limit asks for.`,
    );
  }

  // A fresh symbol per call is the whole cross-instance guard: `NodeId` is
  // branded globally, so an id from another engine typechecks here, and this is
  // the only thing standing between that and a graph quietly holding another
  // engine's nodes.
  const engineId = Symbol("keel-engine");

  const ctx: EngineContext<S> = {
    engineId,
    registry,
    summary: config.summary,
    onUnknownKind: config.onUnknownKind ?? "quarantine",
    onParseFailure: config.onParseFailure ?? "quarantine",
    // `?? DEFAULT_MAX_NODES` and not `Math.min` with it: a consumer who names a
    // ceiling has named THE ceiling, including one above the default. The
    // default is what applies when nobody chose, not a cap on choosing.
    maxNodes: config.maxNodes ?? DEFAULT_MAX_NODES,
    // `null` is unbounded and is the DEFAULT, so `?? null` rather than a
    // number — see `EngineConfig.maxDepth` for why depth is the consumer's
    // ceiling to set and not this package's to invent.
    maxDepth: config.maxDepth ?? null,
    mintId: config.mintId ?? defaultMintId,
    now: config.now ?? Date.now,
    devChecks: config.devChecks ?? false,
  };

  /**
   * The consumer's veto, run STRICTLY BEFORE the reducer.
   *
   * It is not on `EngineContext` and ./commands does not run it, so there is no
   * arrangement of calls in which it lands after a commit. A post-commit veto
   * corrupts redo: the push has already cleared the redo branch, and the undo
   * that follows pushes the REFUSED command onto it.
   *
   * The rejection is relayed verbatim rather than re-coded as
   * `"policy-rejected"` — the consumer knows which of its own rules fired, and
   * flattening that to one code would throw away the only thing it can act on.
   */
  const applyCommandWithPolicy = (
    graph: Graph<Ts, S>,
    command: Command<Ts, S>,
  ): Result<
    Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>,
    Rejection
  > => {
    const veto = config.commandPolicy?.(command, graph);
    if (veto !== undefined && veto !== null) return { ok: false, error: veto };
    return applyCommandTo(graph, command, ctx);
  };

  /**
   * One aggregate read. `cache` is a parameter rather than a closed-over engine
   * field because the two callers have different rights to one (see
   * `engine.aggregate` and `createStore`).
   */
  const aggregateWith = <K extends keyof F>(
    graph: Graph<Ts, S>,
    key: K,
    id: NodeId,
    cache: FoldCache | undefined,
  ): Folded<FoldValue<F[K]>> | undefined => {
    // The registry erases each fold's `A`, so this is `Fold<Ts, S, unknown>`
    // however the key was typed. `undefined` is reachable under
    // `noUncheckedIndexedAccess` for a generic key, and it is also the honest
    // answer for a key that names no fold.
    const fold: SomeFold<Ts, S> | undefined = config.folds[key];
    if (fold === undefined) return undefined;

    const result = computeFold(graph, fold, id, cache);
    if (result === undefined) return undefined;
    return makeFolded<FoldValue<F[K]>>(result);
  };

  // -------------------------------------------------------------------------
  // The store
  // -------------------------------------------------------------------------

  const createStore = (initialGraph: Graph<Ts, S>): Store<Ts, S, F> => {
    let graph = initialGraph;
    let history: History<Ts, S> = createHistory<Ts, S>(config.historyLimit);

    /**
     * PER STORE, not per engine.
     *
     * The cache key is `(foldKey, nodeId, subtreeRev)`, and the property that
     * makes a stale entry unreachable rather than WRONG is that the triple
     * identifies content uniquely. Within one store that holds, because a
     * revision only ever increases. Across two graphs from one engine it does
     * not: two divergent lineages both bump the same node 0 -> 1 with different
     * content, and a shared cache would hand one lineage the other's answer.
     *
     * The limit comes from the config rather than the module default, because
     * the only defensible number is `registered folds x nodes` and this package
     * cannot know either factor. Left unreachable, a consumer past the default's
     * product gets a table that thrashes without saying so.
     */
    const cache = createFoldCache(config.foldCacheLimit);

    /**
     * THE TWO CEILINGS, compared against the graph that actually exists.
     *
     * `maxNodes` says how large a document may be; `foldCacheLimit` says how
     * many (fold, node, rev) entries the memo table holds. They are
     * independent numbers describing one graph, and at the DEFAULTS they
     * disagree: a registry of 8 folds — the size ./folds itself calls
     * realistic — makes the table cover `limit / (folds × FOLD_CACHE_HEADROOM)`
     * = 8,192 nodes, while the node ceiling admits 100,000. That is a factor of
     * twelve, not the factor of six the bare product would suggest.
     *
     * DERIVED, NOT QUOTED, and that is deliberate. These two sentences said
     * "16,384" until the headroom multiple landed, because 16,384 was the bare
     * `limit / folds` and had been right until it wasn't. Writing the division
     * out means the next change to `FOLD_CACHE_HEADROOM` cannot leave this
     * paragraph asserting a number the code disagrees with — which it did, for
     * three pull requests, introduced by the fix for the previous instance of
     * exactly that. `./review3-the-two-default-ceilings-agree.test.ts` holds
     * both numbers executably; this is the reading, not the record.
     *
     * Past that point the LRU does not degrade, it INVERTS: fold k's walk
     * evicts fold 1's entries, fold 1's next read misses at the root, and every
     * mounted card refolds its whole subtree. MEASURED at 20,001 nodes with 8
     * folds — five times under the node ceiling, and accepted by `deserialize`:
     * 188,944 evictions, ZERO hits on an identical repeat, 5,542 ms against
     * 0.017 ms with the table sized to fit. Worse than no cache at all, because
     * every `set` also runs the eviction loop.
     *
     * CHECKED AGAINST `nodesById.size`, NOT AGAINST `maxNodes`, and that
     * distinction is the whole difference between a diagnostic and noise. The
     * first version of this compared the two CEILINGS at `createEngine`, which
     * is where both numbers are in hand — and it fired for twelve of this
     * package's own fixtures, including one that sets `foldCacheLimit: 4`
     * deliberately to exercise eviction. A consumer who sized a small cache on
     * purpose is not making a mistake, and a consumer whose documents are 500
     * nodes does not care that a ceiling they will never reach exceeds a table
     * they will never fill. The real condition is "this table cannot cover THIS
     * graph", and only a store knows that.
     *
     * ONCE per store, latched, and re-checked on commit because a graph grows.
     * The cost is an integer compare behind a boolean that flips at most once.
     */
    let warnedAboutCacheSize = false;
    const warnIfCacheCannotCover = (candidate: Graph<Ts, S>): void => {
      if (warnedAboutCacheSize) return;
      // ONLY WHEN THE LIMIT IS THE DEFAULT. A consumer who wrote a number chose
      // it; the failure this exists to catch belongs to the consumer who wrote
      // none and does not know the default stops comfortably covering at
      // `servable` nodes — 8,192 at 8 folds, computed below rather than quoted
      // here. This is the same rule `maxNodes` states a few lines up — "a
      // consumer who names a ceiling has named THE ceiling" — applied to the
      // other one.
      //
      // It is also what makes the diagnostic quiet enough to keep: checking
      // every store took out four of this package's own capacity tests, which
      // set tiny limits deliberately to exercise eviction. Those stores really
      // will thrash, so the warning was true — and useless, because thrashing
      // was the point.
      if (config.foldCacheLimit !== undefined) return;
      const foldCount = Object.keys(config.folds).length;
      if (foldCount === 0) return;
      const limit = cache.stats().limit;
      if (limit <= 0) return;
      const nodeCount = candidate.nodesById.size;
      // HEADROOM, not the bare product — and the first version of this check
      // used the bare product, which is why it is spelled out here.
      //
      // `folds x nodes` is the FLOOR of the working set, not its resting size:
      // every edit strands `folds x depth` entries, so occupancy grows with the
      // session's edit count until the limit reclaims them. Those strays are
      // not a leak, because a dead-rev entry is never touched again and ages
      // out first — but they are always NEWER than a cold live entry, so at
      // exactly `folds x nodes` there is no room and every stray admission
      // evicts something live.
      //
      // MEASURED against the ideal of `folds x depth` fold calls per post-edit
      // root read: 1.90x ideal at a limit of 1x the product, 1.27x at 2x, and
      // exactly 1.00x at 4x. Two is the knee, and it is what this gate uses.
      //
      // A 16,105-node graph with 8 folds passed the old bare-product check
      // silently (128,840 <= 131,072) while doing 2.04x the fold work per
      // rollup after 2,000 edits — at a fixed graph size, driven purely by
      // churn. That is the exact silent degradation this warning exists for,
      // and it sat just under the threshold.
      const want = foldCount * nodeCount * FOLD_CACHE_HEADROOM;
      if (want <= limit) return;
      warnedAboutCacheSize = true;
      const servable = Math.floor(limit / (foldCount * FOLD_CACHE_HEADROOM));
      console.error(
        `keel: this graph holds ${nodeCount} nodes and ${foldCount} fold(s) are registered, ` +
          `but foldCacheLimit (${limit}) comfortably covers only ${servable} nodes. Past that ` +
          `the memo table thrashes and every rollup refolds from scratch — measurably slower ` +
          `than no cache at all. Raise EngineConfig.foldCacheLimit to at least ${want} ` +
          `(folds x nodes x ${FOLD_CACHE_HEADROOM} for edit churn). ` +
          `EngineConfig.onFoldCacheStats reports evictions if you want to watch it.`,
      );
    };
    warnIfCacheCannotCover(initialGraph);

    /**
     * The OTHER thing a graph outgrows, and it outgrows it silently.
     *
     * A commit copies whole maps — see `DEFAULT_INTERACTIVE_NODE_BUDGET` for
     * which ones and what they cost — so the price of a keystroke is set by how
     * many nodes the document holds, not by how small the edit was. There is no
     * symptom short of a laggy app: nothing throws, nothing is dropped, every
     * result is correct, and the frame is simply gone.
     *
     * SAME SHAPE AS THE CACHE WARNING ABOVE, and for the same reasons. Checked
     * against `nodesById.size` rather than a ceiling, because the ceiling is a
     * number about payloads and this is a question about THIS graph. Latched,
     * so it is one integer compare behind a boolean after the first crossing.
     * Re-checked on commit, because the case a load-time check cannot see is
     * the document that loads small and grows.
     *
     * NOT GATED ON `maxNodes`, and that is the one place it departs from the
     * cache warning. `foldCacheLimit` and the table it sizes answer the same
     * question, so naming one is choosing. `maxNodes` does not: it is a trust
     * boundary against hostile payloads, and a consumer who set it to 50,000 to
     * bound allocation has said nothing whatever about what they will accept
     * per keystroke. Reading their security number as a performance opinion
     * would silence exactly the deployment most likely to need this.
     */
    let warnedAboutCommitCost = false;
    const warnIfCommitCostIsPastInteractive = (candidate: Graph<Ts, S>): void => {
      if (warnedAboutCommitCost) return;
      const budget = config.interactiveNodeBudget ?? DEFAULT_INTERACTIVE_NODE_BUDGET;
      // A named budget is a choice, and `0` is how that choice says "never".
      if (budget <= 0) return;
      const nodeCount = candidate.nodesById.size;
      if (nodeCount <= budget) return;
      warnedAboutCommitCost = true;
      console.error(
        `keel: this graph holds ${nodeCount} live nodes, past the ${budget} this engine ` +
          `treats as interactive. A commit copies whole maps — every mutation copies ` +
          `subtreeRevById, a data change also copies nodesById, an insert or removal copies ` +
          `four — so a commit costs what the DOCUMENT costs, not what the edit costs: ` +
          `measured at 3.3 ms per keystroke at 25,000 nodes and 17.1 ms at 100,000, where ` +
          `one keystroke is a whole 60Hz frame before anything renders. Set ` +
          `EngineConfig.interactiveNodeBudget to silence this once you have priced it.`,
      );
    };
    warnIfCommitCostIsPastInteractive(initialGraph);

    // Handed out here, before the store exists and before any fold can run, so
    // a consumer that wants the counters has them from the first `aggregate`
    // rather than from whenever it next remembered to ask.
    config.onFoldCacheStats?.(() => cache.stats());

    const nodeListeners = new Map<NodeId, Set<() => void>>();
    const graphListeners = new Set<() => void>();
    const changeListeners = new Set<(change: Change<Ts, S>) => void>();
    const selectionListeners = new Set<() => void>();

    let selectedIds: readonly NodeId[] = [];
    /**
     * The same selection, as a membership index.
     *
     * `has` is the per-card hot path — `useIsSelected` calls it once per mounted
     * card on every selection change — and it was `selectedIds.includes(id)`,
     * which is O(selected). One render pass across N cards with M selected was
     * therefore O(N x M): measured at 0.28ms for 500 cards, 3.7ms for 2,000 and
     * 63ms for 8,000, which is four dropped frames every time the selection
     * moves.
     *
     * Kept BESIDE the array rather than replacing it, because the array is the
     * contract: `get()` hands out an ORDERED, identity-stable list that the
     * React binding memoises on, and a Set has neither property. The two are
     * only ever written together, in the two places `selectedIds` is assigned.
     */
    let selectedSet: ReadonlySet<NodeId> = new Set();
    let anchorId: NodeId | null = null;
    let destroyed = false;

    /**
     * Run ONE consumer callback so that its failure cannot become the engine's.
     *
     * Every listener below is consumer code, and before this existed a single
     * one of them throwing did three things at once, all of them worse than the
     * original error:
     *
     *   1. The exception escaped `dispatch` — a function whose entire contract
     *      is that it returns a `Result` and does not throw. It escaped AFTER
     *      the graph had committed and history had been pushed, so the caller
     *      saw a failure for a mutation that had actually succeeded.
     *   2. Every listener after it in the same set was starved. One consumer's
     *      bad callback silently disabled another's.
     *   3. Worst, `emitChange` is sequenced after `commitGraph`, so a throwing
     *      GRAPH subscriber meant the change feed never emitted at all. The
     *      edit existed in memory and in the undo stack and was never announced
     *      to whatever performs the write. Measured: graph committed, `canUndo`
     *      true, change-feed listeners fired zero times.
     *
     * SWALLOWED AND REPORTED, not rethrown, and it is the same judgement
     * `auditIfDev` already makes: a throw here takes down a render for a
     * condition the user cannot fix, and the engine has no way to undo a
     * notification half-delivered. `console.error` rather than silence, because
     * a subscriber that throws on every commit is a real bug in the consumer
     * and must not be invisible.
     */
    const notifyOne = (label: string, deliver: () => void): void => {
      try {
        deliver();
      } catch (thrown) {
        console.error(
          `keel: a ${label} subscriber threw. The commit is unaffected and the ` +
            `remaining subscribers still ran, but this callback must not throw.`,
          thrown,
        );
      }
    };

    const notifyAll = (
      label: string,
      listeners: ReadonlySet<() => void>,
    ): void => {
      // Copied before iterating: a listener that unsubscribes itself (the
      // normal React teardown) mutates the set mid-iteration otherwise.
      for (const listener of [...listeners]) notifyOne(label, listener);
    };

    /**
     * Dev-only audit. It is NOT a rejection: every `RejectionCode` names
     * something a consumer can act on, and "the engine corrupted its own graph"
     * is not one — a code for it would make every call site write handling for
     * a case that must never ship. Reported, never thrown, because a throw here
     * takes down a render for a condition the user cannot fix.
     */
    const auditIfDev = (label: string, next: Graph<Ts, S>): void => {
      if (!ctx.devChecks) return;
      const violation = findInvariantViolationIn(next, registry);
      if (violation === null) return;
      console.error(
        `keel: invariant violated after ${label}: ${violation.code} — ${violation.message}`,
        violation,
      );
    };

    /** Selection is not in the graph, so removal has to prune it explicitly. */
    const pruneSelection = (): boolean => {
      const kept = selectedIds.filter((id) => getNode(graph, id) !== undefined);
      const anchorGone =
        anchorId !== null && getNode(graph, anchorId) === undefined;
      if (kept.length === selectedIds.length && !anchorGone) return false;
      selectedIds = kept;
      selectedSet = new Set(kept);
      if (anchorGone) anchorId = null;
      return true;
    };

    /**
     * The one place `graph` is reassigned.
     *
     * Notification order is the contract: node subscribers for every changed
     * revision, then graph subscribers, then selection. The change feed is NOT
     * emitted here — `load`, `ingest` and `markMissing` are IO landing and emit
     * nothing on it, so the caller decides.
     */
    const commitGraph = (next: Graph<Ts, S>, label: string): void => {
      const previous = graph;
      // Identity is preserved by the no-op paths (`markMissing` on a stale id,
      // an ingest that changed nothing), and a notification storm for a no-op
      // is exactly what `subtreeRev` exists to prevent.
      if (next === previous) return;

      graph = next;
      auditIfDev(label, next);
      // A graph grows; the table does not, and neither does the frame. Both
      // latched, so each is one integer compare behind a boolean after the
      // first crossing.
      warnIfCacheCannotCover(next);
      warnIfCommitCostIsPastInteractive(next);

      const selectionChanged = pruneSelection();

      // Only SUBSCRIBED ids are compared, so this is O(mounted cards) rather
      // than O(graph).
      //
      // WHAT MAKES A REMOVAL VISIBLE HERE lives in ./patches, not in this
      // comparison, and saying so is the whole point of writing it down. An
      // earlier version of this comment claimed the credit for itself —
      // "`getSubtreeRev` answers 0 for an unknown node, which is what makes a
      // removal and an insertion both register as a change" — and that was true
      // only while `applyRemoved` DELETED the removed id's revision entry. It
      // now leaves a tombstone behind (a fold-cache requirement, see there), so
      // a frozen tombstone would read back identical on both sides of this
      // comparison and the deleted node's own subscribers would never fire.
      // `applyRemoved` bumps the entry it tombstones for exactly this reason.
      //
      // The rule this loop actually depends on, and the only one to preserve:
      // EVERY MUTATION MOVES THE REVISION OF EVERY NODE IT AFFECTS, including a
      // node it affects by deleting.
      for (const [id, listeners] of nodeListeners) {
        if (getSubtreeRev(previous, id) === getSubtreeRev(next, id)) continue;
        for (const listener of [...listeners]) notifyOne("node", listener);
      }

      notifyAll("graph", graphListeners);
      // A selection change must never notify graph subscribers; the reverse —
      // a graph change pruning the selection — must notify selection ones.
      if (selectionChanged) notifyAll("selection", selectionListeners);
    };

    const emitChange = (change: Change<Ts, S>): void => {
      for (const listener of [...changeListeners]) {
        notifyOne("change-feed", () => {
          listener(change);
        });
      }
    };

    const setSelection = (
      ids: readonly NodeId[],
      nextAnchor: NodeId | null,
    ): void => {
      const seen = new Set<NodeId>();
      const deduped: NodeId[] = [];
      for (const id of ids) {
        if (seen.has(id)) continue;
        // Selection stays a subset of the graph, so `has()` never answers true
        // for a node the consumer can no longer render.
        if (getNode(graph, id) === undefined) continue;
        seen.add(id);
        deduped.push(id);
      }

      // The anchor is always IN the selection — it is where a range extends
      // FROM, and an anchor outside the selection would extend from a card the
      // user cannot see is anchored.
      const resolvedAnchor =
        nextAnchor !== null && seen.has(nextAnchor) ? nextAnchor : null;

      if (resolvedAnchor === anchorId && sameIds(deduped, selectedIds)) return;
      selectedIds = deduped;
      // `seen` was already built to dedupe, and it holds exactly the ids that
      // survived into `deduped` — so the membership index costs nothing extra.
      selectedSet = seen;
      anchorId = resolvedAnchor;
      notifyAll("selection", selectionListeners);
    };

    const selection: SelectionSlice = {
      get: () => selectedIds,
      has: (id) => selectedSet.has(id),
      set: (ids) => {
        setSelection(ids, ids.at(-1) ?? null);
      },
      toggle: (id) => {
        if (!selectedSet.has(id)) {
          setSelection([...selectedIds, id], id);
          return;
        }
        const kept = selectedIds.filter((other) => other !== id);
        setSelection(kept, anchorId === id ? (kept.at(-1) ?? null) : anchorId);
      },
      clear: () => {
        setSelection([], null);
      },
      selectRange: (anchor, to) => {
        // DOCUMENT order, which is why selection lives beside the graph rather
        // than in the consumer: the range between two cards is a fact about the
        // tree, not about the list one view happens to render.
        const order = documentOrder(graph);
        const from = order.indexOf(anchor);
        const until = order.indexOf(to);
        // A card can outlive its node by a frame. A no-op beats a range
        // computed from a -1.
        if (from === -1 || until === -1) return;
        const lo = Math.min(from, until);
        const hi = Math.max(from, until);
        setSelection(order.slice(lo, hi + 1), anchor);
      },
      anchor: () => anchorId,
      subscribe: (listener) => {
        if (destroyed) return noop;
        selectionListeners.add(listener);
        return () => {
          selectionListeners.delete(listener);
        };
      },
    };

    return {
      getGraph: () => graph,

      subscribeToNode(id, listener) {
        if (destroyed) return noop;
        const listeners = nodeListeners.get(id) ?? new Set<() => void>();
        listeners.add(listener);
        nodeListeners.set(id, listeners);
        return () => {
          const current = nodeListeners.get(id);
          if (current === undefined) return;
          current.delete(listener);
          // Dropping the empty set keeps `commitGraph`'s loop proportional to
          // what is actually mounted, not to everything ever mounted.
          if (current.size === 0) nodeListeners.delete(id);
        };
      },

      subscribeToGraph(listener) {
        if (destroyed) return noop;
        graphListeners.add(listener);
        return () => {
          graphListeners.delete(listener);
        };
      },

      subscribeToChanges(listener) {
        if (destroyed) return noop;
        changeListeners.add(listener);
        return () => {
          changeListeners.delete(listener);
        };
      },

      dispatch(command, options) {
      // A destroyed store REFUSES rather than writes. `destroy()` clears every
      // listener and the fold cache, so a mutation after it lands in a graph
      // nothing is subscribed to and no cache reflects — a zombie write whose
      // only symptom is a later read disagreeing with the UI. The subscribe
      // methods above already treat post-destroy calls as benign (they return
      // a no-op unsubscribe); this is the same decision for the write half.
      //
      // A `Result`, not a throw: unmount races are ordinary in React — an
      // in-flight callback firing after the provider tore down is not a
      // programmer error the way a duplicate kind at module init is.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "dispatch() on a destroyed store.",
            },
          };
        }
        const applied = applyCommandWithPolicy(graph, command);
        if (!applied.ok) return applied;

        const { graph: nextGraph, patch } = applied.value;
        const at = ctx.now();
        // Pushed BEFORE anything is notified, so a listener that reads
        // `canUndo()` synchronously sees the entry its own change created.
        history = pushHistory(history, {
          command,
          patch,
          at,
          coalesceKey: options?.coalesceKey,
        });
        commitGraph(nextGraph, "dispatch");
        emitChange({
          patch,
          source: "command",
          detachedSubtrees: patchDetachedSubtrees(patch),
          at,
        });
        return { ok: true, value: patch };
      },

      resolveDrop: (intent) => resolveDropIn(graph, intent, ctx),

      /**
       * PEEK, VERIFY, COMMIT, APPLY — in that order, and the order is the
       * point. Loading grows the graph while entries sleep, so a dormant patch
       * has to be verified BEFORE the stack moves; committing first would drop
       * the entry on a rejection and lose the undo step entirely.
       */
      undo() {
      // A destroyed store REFUSES rather than writes. `destroy()` clears every
      // listener and the fold cache, so a mutation after it lands in a graph
      // nothing is subscribed to and no cache reflects — a zombie write whose
      // only symptom is a later read disagreeing with the UI. The subscribe
      // methods above already treat post-destroy calls as benign (they return
      // a no-op unsubscribe); this is the same decision for the write half.
      //
      // A `Result`, not a throw: unmount races are ordinary in React — an
      // in-flight callback firing after the provider tore down is not a
      // programmer error the way a duplicate kind at module init is.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "undo() on a destroyed store.",
            },
          };
        }
        const entry = peekUndo(history);
        if (entry === null) return { ok: false, error: nothingToReplay("undo") };

        const inverse = invertPatchOf(entry.patch);
        const verified = verifyPatchAppliesTo(graph, inverse, ctx);
        if (!verified.ok) return verified;

        const committed = commitUndo(history);
        // Unreachable — `peekUndo` just answered — but checked rather than
        // asserted with `!`, because the alternative is a crash in a stack this
        // module is not otherwise able to corrupt.
        if (committed === null) {
          return { ok: false, error: nothingToReplay("undo") };
        }
        history = committed.history;

        const at = ctx.now();
        commitGraph(applyPatchTo(graph, inverse, ctx), "undo");
        emitChange({
          patch: inverse,
          source: "undo",
          detachedSubtrees: patchDetachedSubtrees(inverse),
          at,
        });
        return { ok: true, value: inverse };
      },

      /**
       * The stored patch is replayed AS RECORDED, ids included. Re-minting on
       * redo would hand back a different node than the one every reference,
       * selection entry and open editor is still pointing at.
       */
      redo() {
      // A destroyed store REFUSES rather than writes. `destroy()` clears every
      // listener and the fold cache, so a mutation after it lands in a graph
      // nothing is subscribed to and no cache reflects — a zombie write whose
      // only symptom is a later read disagreeing with the UI. The subscribe
      // methods above already treat post-destroy calls as benign (they return
      // a no-op unsubscribe); this is the same decision for the write half.
      //
      // A `Result`, not a throw: unmount races are ordinary in React — an
      // in-flight callback firing after the provider tore down is not a
      // programmer error the way a duplicate kind at module init is.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "redo() on a destroyed store.",
            },
          };
        }
        const entry = peekRedo(history);
        if (entry === null) return { ok: false, error: nothingToReplay("redo") };

        const forward = entry.patch;
        const verified = verifyPatchAppliesTo(graph, forward, ctx);
        if (!verified.ok) return verified;

        const committed = commitRedo(history);
        if (committed === null) {
          return { ok: false, error: nothingToReplay("redo") };
        }
        history = committed.history;

        const at = ctx.now();
        commitGraph(applyPatchTo(graph, forward, ctx), "redo");
        emitChange({
          patch: forward,
          source: "redo",
          detachedSubtrees: patchDetachedSubtrees(forward),
          at,
        });
        return { ok: true, value: forward };
      },

      canUndo: () => historyCanUndo(history),
      canRedo: () => historyCanRedo(history),

      /**
       * IO landing. No patch, no history entry, NO change-feed event — the
       * consumer performed the write and already knows about it; echoing it
       * back is how a persistence loop starts.
       */
      ingest(edits) {
        // See `dispatch` for why a destroyed store refuses rather than writes.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "ingest() on a destroyed store.",
            },
          };
        }
        const ingested = applyIngestEdits(graph, history, edits, ctx);
        if (!ingested.ok) return ingested;
        history = ingested.value.history;
        commitGraph(ingested.value.graph, "ingest");
        return { ok: true, value: ingested.value.scrubbed };
      },

      load(id, doc) {
        // See `dispatch` for why a destroyed store refuses rather than writes.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "load() on a destroyed store.",
            },
          };
        }
        const loaded = loadChildrenInto<Ts, S>(graph, id, doc, ctx);
        if (!loaded.ok) return loaded;
        commitGraph(loaded.value, "load");
        return { ok: true, value: undefined };
      },

      markMissing(id, reason) {
        // See `dispatch` for why a destroyed store refuses rather than writes.
        // Returns void, so there is nothing to reject with — it simply does
        // not write.
        if (destroyed) return;
        commitGraph(markMissingIn(graph, id, reason), "markMissing");
      },

      aggregate<K extends keyof F>(
        key: K,
        id: NodeId,
      ): Folded<FoldValue<F[K]>> | undefined {
        return aggregateWith(graph, key, id, cache);
      },

      selection,

      destroy() {
        destroyed = true;
        nodeListeners.clear();
        graphListeners.clear();
        changeListeners.clear();
        selectionListeners.clear();
        cache.clear();
      },
    };
  };

  // -------------------------------------------------------------------------
  // The engine surface
  // -------------------------------------------------------------------------

  return {
    engineId,

    deserialize: (raw) => deserializeDocument<Ts, S>(raw, ctx),
    serialize: (graph) => serializeGraph(graph, ctx),

    applyCommand: (graph, command) => applyCommandWithPolicy(graph, command),
    applyPatch: (graph, patch) => applyPatchTo(graph, patch, ctx),
    invertPatch: (patch) => invertPatchOf(patch),
    verifyPatchApplies: (graph, patch) =>
      verifyPatchAppliesTo(graph, patch, ctx),
    findInvariantViolation: (graph) => findInvariantViolationIn(graph, registry),
    resolveDrop: (graph, intent) => resolveDropIn(graph, intent, ctx),

    loadChildren: (graph, id, doc) =>
      loadChildrenInto<Ts, S>(graph, id, doc, ctx),
    markMissing: (graph, id, reason) => markMissingIn(graph, id, reason),
    applyIngest: (graph, history, edits) =>
      applyIngestEdits(graph, history, edits, ctx),

    /**
     * UNCACHED, deliberately. This takes an arbitrary graph, so
     * `(foldKey, nodeId, subtreeRev)` no longer identifies content — two graphs
     * from this engine can hold the same node at the same revision with
     * different data, and a cache hit would be silently WRONG rather than
     * merely stale. `createStore`'s aggregate owns a single lineage and is
     * cached.
     */
    aggregate<K extends keyof F>(graph: Graph<Ts, S>, key: K, id: NodeId) {
      return aggregateWith(graph, key, id, undefined);
    },

    createStore,

    // Phantom. `typeof engine.types.Node` is the point; reading it at runtime
    // yields `undefined`, and nothing should.
    types: undefined as never,
  };
}
