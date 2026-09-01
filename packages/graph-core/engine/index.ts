// Graph — the assembled engine surface, and the store that owns a live graph.
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
//   2. the store, which is the only stateful thing in graph-core.


import type {
  Change,
  Command,
  Engine,
  EngineConfig,
  RequireTupleTypes,
  EngineContext,
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
  WidenedFold,
  WidenedNodeType,
  Store,
} from "../types";
import {
  describeThrown,
  describeValue,
  makeFolded,
  structurallyEqualBounded,
} from "../types";
import {
  buildRegistry,
  documentOrder,
  findInvariantViolation as findInvariantViolationIn,
  getNode,
  getSubtreeRev,
  KeyHookFailure,
  keyHookMessage,
  markMissing as markMissingIn,
} from "../graph";
import {
  applyPatch as applyPatchTo,
  invertPatch as invertPatchOf,
  patchDetachedSubtrees,
  verifyPatchApplies as verifyPatchAppliesTo,
} from "../patches";
import {
  applyCommand as applyCommandTo,
  applyNonUndoableWriteEdits,
  resolveDrop as resolveDropIn,
} from "../commands";
import {
  computeFold,
  createFoldCache,
  type ObservableFoldCache,
} from "../folds";
import {
  DEFAULT_MAX_NODE_ID_LENGTH,
  DEFAULT_MAX_NODES,
  deserializeDocument,
  loadChildrenInto,
  serializeGraph,
} from "../serialize";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  clearFuture as historyClearFuture,
  clearHistory as historyClearHistory,
  clearPast as historyClearPast,
  commitRedo,
  commitUndo,
  createHistory,
  peekRedo,
  peekUndo,
  pushHistory,
} from "../history";
import { defaultMintId, noop, nothingToReplay, sameIds } from "./defaults";
import { SHADOW_REFOLD_BUDGET } from "./constants";
import { makeCommitWarnings } from "./warnings";

export { DEFAULT_INTERACTIVE_NODE_BUDGET } from "./constants";


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
 * Defaults: `onUnknownKind` and `onParseFailure` seal, `mintId` a
 * counter-plus-random id, `now` `Date.now`, `historyLimit` unbounded,
 * `foldCacheLimit` `DEFAULT_FOLD_CACHE_LIMIT` (a folds x nodes product — see
 * ./folds), `devChecks` off.
 */
export function createEngine<
  const Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
>(
  config: EngineConfig<Ts, S, F> & RequireTupleTypes<Ts>,
): Engine<Ts, S, F> {
  const registry = buildRegistry(config.types);

  // ConsumerDefinedFold keys must be unique, and this is the check `readCachedFold` in
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
        `graph-core: duplicate fold key ${JSON.stringify(fold.key)} — registered as ` +
          `both ${JSON.stringify(prior)} and ${JSON.stringify(entryKey)}. ConsumerDefinedFold ` +
          `keys are cache keys; two folds sharing one would read each other's ` +
          `cached values.`,
      );
    }
    foldKeyOwners.set(fold.key, entryKey);
  }

  /**
   * The fold registry as a MAP, for the same reason `NodeTypeRegistry` is one.
   *
   * `aggregate<K extends keyof F>` constrains its key at compile time and
   * nothing else did: `config.folds[key]` is a raw object index, so an untyped
   * or dynamically-built call site asking for `"toString"` found
   * `Function.prototype.toString`, sailed past the `undefined` guard, and threw
   * `TypeError: Cannot read properties of undefined (reading 'length')` out of
   * `cacheKey` — from a function whose doc promises `undefined` for a key that
   * names no fold, in a package where nothing is supposed to throw after
   * construction.
   *
   * The node type registry closed exactly this hole by being a `Map`, and
   * ./serialize closes it for wire-controlled kind names with
   * `Object.create(null)`. The fold registry was the one lookup still reading
   * through a prototype chain. `Object.entries` takes own enumerable string
   * keys only, so inherited names simply are not in here.
   */
  const foldsByKey: ReadonlyMap<string, WidenedFold<Ts, S>> = new Map(
    Object.entries(config.folds),
  );

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
      `graph-core: historyLimit must be a positive integer, received ${String(historyLimit)}. ` +
        `Omit it entirely for unbounded history — a fractional or non-positive value ` +
        `would silently mean unbounded, which is the opposite of what naming a limit asks for.`,
    );
  }

  // THE SAME ARGUMENT, for the two ceilings that were not making it.
  //
  // `historyLimit` refuses a value that would silently mean unbounded. These
  // two accepted one. `maxNodes: NaN` and `maxNodes: Infinity` both make every
  // `count > ctx.maxNodes` comparison false, so the ingress trust boundary and
  // all three growth doors stop refusing anything — and `NaN` arrives for free
  // from `Number(fromEnv)` or a `parseInt` of a missing setting, which is
  // exactly how a production ceiling goes missing without a line of code
  // looking wrong. The failure is silent in the unsafe direction: the consumer
  // asked to bound the graph and got no bound.
  //
  // `maxDepth` takes `null`/omitted as unbounded BY DESIGN — see its doc on
  // `EngineConfig` — so the check is on values that are present and not null.
  // Omitting either field stays silent, which is how a consumer asks for the
  // default and for unbounded respectively.
  for (const [name, value] of [
    ["maxNodes", config.maxNodes],
    ["maxDepth", config.maxDepth],
    // The third ceiling, validated with its two siblings rather than beside
    // them — `maxNodeIdLength: NaN` disables the bound exactly the way
    // `maxNodes: NaN` does, and for the same reason: every `length > ceiling`
    // comparison goes false.
    ["maxNodeIdLength", config.maxNodeIdLength],
  ] as const) {
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `graph-core: ${name} must be a positive integer, received ${String(value)}. ` +
          `NaN and Infinity make every ceiling comparison false, which disables ` +
          `the limit entirely — the opposite of what naming one asks for. Omit ` +
          `the field to take the default.`,
      );
    }
  }

  // A fresh symbol per call is the whole cross-instance guard: `NodeId` is
  // branded globally, so an id from another engine typechecks here, and this is
  // the only thing standing between that and a graph quietly holding another
  // engine's nodes.
  const engineId = Symbol("graph-engine");

  const ctx: EngineContext<S> = {
    engineId,
    registry,
    summary: config.summary,
    onUnknownKind: config.onUnknownKind ?? "seal",
    onParseFailure: config.onParseFailure ?? "seal",
    // `?? DEFAULT_MAX_NODES` and not `Math.min` with it: a consumer who names a
    // ceiling has named THE ceiling, including one above the default. The
    // default is what applies when nobody chose, not a cap on choosing.
    maxNodes: config.maxNodes ?? DEFAULT_MAX_NODES,
    // `null` is unbounded and is the DEFAULT, so `?? null` rather than a
    // number — see `EngineConfig.maxDepth` for why depth is the consumer's
    // ceiling to set and not this package's to invent.
    maxDepth: config.maxDepth ?? null,
    // `??`, not `?? null`: this one HAS a default, like `maxNodes` and unlike
    // `maxDepth`, so omitting it takes the number and only an explicit `null`
    // opts out. See `EngineConfig.maxNodeIdLength`.
    maxNodeIdLength:
      config.maxNodeIdLength === undefined
        ? DEFAULT_MAX_NODE_ID_LENGTH
        : config.maxNodeIdLength,
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
    cache: ObservableFoldCache | undefined,
  ): Folded<FoldValue<F[K]>> | undefined => {
    // The registry erases each fold's `A`, so this is `ConsumerDefinedFold<Ts, S, unknown>`
    // however the key was typed. `undefined` is reachable under
    // `noUncheckedIndexedAccess` for a generic key, and it is also the honest
    // answer for a key that names no fold.
    const fold = foldsByKey.get(String(key));
    if (fold === undefined) return undefined;

    // ---- THE SHADOW COLD REFOLD, rescoped to CACHE HITS ONLY ---------------
    //
    // The audit as originally specified was "beside every cached fold read",
    // which is either vacuous or ruinous depending on which reads it catches.
    // MEASURED on an instrumented run: 28 of 35 shadow executions compared a
    // COLD result against a COLD result — 11 on the deliberately uncached
    // `engine.aggregate` path and 17 on plain misses — so 80% of the cost
    // bought a comparison that could not fail. A miss has nothing memoized to
    // be wrong.
    //
    // Checking the top-level entry FIRST is what fixes that. If it is a hit,
    // the answer about to be returned came out of the table, and folding the
    // same subtree cold is a genuine test of it. If it is a miss, there is
    // nothing to audit and the shadow is skipped.
    //
    // WHY THIS MATTERS MORE THAN THE OTHER THREE: the table's ONLY invalidation
    // mechanism is the (foldKey, nodeId, rev) key. Nothing evicts for
    // correctness, so a stale entry is served silently and forever — and that
    // has shipped twice, both times as a wrong aggregate at the root that never
    // self-healed.
    // `fold.key`, NOT the registry's record key, and `peek`, NOT `get`. Both
    // were wrong and each broke something different.
    //
    // THE KEY. `computeFold` reads and writes under `fold.key`; this probed
    // under `String(key)`, which is the key in the `folds` RECORD. Those are
    // allowed to differ — `{ duration: someFold }` where `someFold.key` is
    // `"duration-v2"` is legal, and `createEngine` only refuses duplicate
    // `fold.key`s. Wherever they differed the probe found nothing, `shadowable`
    // was never true, and THE AUDIT SILENTLY DID NOT RUN. That is the check
    // ./folds singles out as mattering most, because the memo table's only
    // invalidation is the rev in its key: a stale entry is served forever and
    // has shipped twice. Every existing test registers a fold whose two names
    // agree, so nothing caught it.
    //
    // THE READ. `get` counts a hit or a miss and re-inserts for LRU order, so
    // the probe was scoring itself into `FoldCacheStats` — the one instrument a
    // consumer has for telling a table that has stopped helping from one that
    // never helped. Measured on one warm root read with `devChecks: true`:
    // +2 hits where the honest answer is +1 when the names agree, and
    // +1 hit / +1 miss when they differ. `peek` answers without touching
    // either.
    const shadowable =
      ctx.devChecks &&
      cache !== undefined &&
      cache.peek(fold.key, id, getSubtreeRev(graph, id));

    const result = computeFold(graph, fold, id, cache);
    if (result === undefined) return undefined;

    if (shadowable) shadowCheck(graph, fold, id, result.value, String(key));

    return makeFolded<FoldValue<F[K]>>(result);
  };

  /**
   * BUDGETED, and the budget is not optional. A cold fold over a large subtree
   * is real work — measured at 101ms over 100,000 nodes — and doing it on every
   * cached read would make dev mode unusable rather than merely slower. The cap
   * is per ENGINE and announces itself once when it runs out, so a reader is
   * never left believing an audit is running after it has gone quiet.
   */
  let shadowsLeft = SHADOW_REFOLD_BUDGET;
  /**
   * Whether any comparison actually disagreed, so the sign-off below can say
   * which happened.
   *
   * The message used to assert "Everything it checked agreed" UNCONDITIONALLY —
   * printed on exhaustion whether or not a stale entry had already been reported
   * above it. A diagnostic whose closing line contradicts its own findings is
   * worse than one that says nothing, because the summary is what a reader
   * scrolling a console keeps.
   */
  let shadowFoundStale = false;

  /**
   * ONE comparison. Split out so the budget accounting around it is a
   * three-line function rather than something the early returns can escape.
   *
   * Every path here returns without announcing anything about the budget —
   * that is `shadowCheck`'s job, and it was the entanglement of the two that
   * produced the off-by-one below.
   */
  const compareShadow = (
    graph: Graph<Ts, S>,
    fold: WidenedFold<Ts, S>,
    id: NodeId,
    cachedValue: unknown,
    key: string,
  ): void => {
    // NO CACHE ARGUMENT — that is what makes it cold. Passing one would let the
    // shadow populate the very table it is auditing, and it would then be
    // comparing an entry against itself.
    let fresh: ReturnType<typeof computeFold<Ts, S, unknown>>;
    try {
      fresh = computeFold(graph, fold, id, undefined);
    } catch (thrown) {
      console.error(
        `graph dev check: a shadow cold refold of ${JSON.stringify(key)} threw. ` +
          describeThrown(thrown),
      );
      return;
    }
    if (fresh === undefined) return;
    if (structurallyEqualBounded(fresh.value, cachedValue) !== false) return;
    shadowFoundStale = true;
    console.error(
      `graph dev check: the memo table served a STALE ${JSON.stringify(key)} for node ` +
        `${JSON.stringify(id)}. Cached and freshly folded values disagree, which means an ` +
        `entry outlived the revision that should have made it unreachable. ` +
        `cached=${describeValue(cachedValue)} fresh=${describeValue(fresh.value)}`,
    );
  };

  const shadowCheck = (
    graph: Graph<Ts, S>,
    fold: WidenedFold<Ts, S>,
    id: NodeId,
    cachedValue: unknown,
    key: string,
  ): void => {
    if (shadowsLeft <= 0) return;
    shadowsLeft -= 1;
    // THE COMPARISON FIRST, THEN THE SIGN-OFF, and that order is the fix rather
    // than a rearrangement. The announcement used to sit between the decrement
    // and the work, with a `return` after it, so the call that took the counter
    // from 1 to 0 announced the budget spent and then DID NOT COMPARE. The
    // engine ran 999 of the 1,000 it reported, and the one it skipped was a real
    // audited read — silently, on the audit whose whole purpose is that a stale
    // entry is otherwise served forever.
    compareShadow(graph, fold, id, cachedValue, key);
    if (shadowsLeft === 0) {
      console.error(
        `graph dev check: the shadow cold refold has spent its budget of ` +
          `${SHADOW_REFOLD_BUDGET} comparisons and is now OFF for this engine. ` +
          `${
            shadowFoundStale
              ? "It reported at least one STALE entry above; later reads are no longer audited."
              : "Everything it checked agreed; later reads are no longer audited."
          }`,
      );
    }
  };

  // -------------------------------------------------------------------------
  // The store
  // -------------------------------------------------------------------------

  /**
   * `applyPatch` returns a `Graph`, not a `Result`, and is documented as
   * deliberately re-checking nothing because verify ran first. But verify does
   * NOT read the two key hooks on every path `applyPatch` does — measured, a
   * throwing `contentKey` cleared `verifyPatchApplies` and then threw out of
   * `applyPatch`, so `undo()` broke its own `Result` contract even after the
   * verify door was guarded.
   *
   * `instanceof` the private tag, like every other guard here.
   *
   * AT ENGINE SCOPE, not inside `createStore`, because `applyPatchChecked` on
   * the engine surface owes a consumer driving its own replay exactly the
   * guarantee `undo` and `redo` already had. It closes over `ctx` and nothing
   * a store owns, which is what makes hoisting it a move rather than a copy —
   * and a second copy is what would drift.
   */
  const applyReplayPatch = (
    from: Graph<Ts, S>,
    patch: Patch<Ts, S>,
  ): Result<Graph<Ts, S>, ReplayRejection> => {
    try {
      return { ok: true, value: applyPatchTo(from, patch, ctx) };
    } catch (thrown) {
      if (thrown instanceof KeyHookFailure) {
        return {
          ok: false,
          error: {
            code: "node-type-threw",
            message: keyHookMessage(thrown),
            ...(thrown.nodeId === null ? {} : { nodeId: thrown.nodeId }),
          },
        };
      }
      throw thrown;
    }
  };

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
    const { warnIfCacheCannotCover, warnIfCommitCostIsPastInteractive } =
      makeCommitWarnings(config, cache);
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
          `graph-core: a ${label} subscriber threw. The commit is unaffected and the ` +
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
        `graph-core: invariant violated after ${label}: ${violation.code} — ${violation.message}`,
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
     * emitted here — `load`, `applyNonUndoableWrite` and `markMissing` are IO landing and emit
     * nothing on it, so the caller decides.
     */
    const commitGraph = (next: Graph<Ts, S>, label: string): void => {
      const previous = graph;
      // Identity is preserved by the no-op paths (`markMissing` on a stale id,
      // a write that changed nothing), and a notification storm for a no-op
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
      // SNAPSHOT, for the reason `notifyAll` copies its set — this was the one
      // notification loop that read a LIVE collection while calling consumer
      // code allowed to mutate it, and the map is the half where that does not
      // merely skip an entry but fails to terminate.
      //
      // A listener that re-subscribes to its own id during notification (the
      // ordinary `useSyncExternalStore` teardown-and-resubscribe, which React
      // runs whenever the subscribe callback identity changes) unsubscribes
      // first: the set empties and `subscribeToNode`'s cleanup DELETES the map
      // entry to keep this loop proportional to what is mounted. Re-subscribing
      // then re-inserts that id at the END of the map's iteration order, where
      // the live iterator has not been yet. Its rev still differs across the
      // commit, so it is notified again, and re-subscribes again. The commit
      // never finishes and the tab locks up.
      //
      // Snapshotting also settles what a subscription created DURING a commit
      // observes, and settles it the same way the flat sets already do: it was
      // not subscribed when the change happened, so it is not told about it.
      //
      // One array per commit, sized by MOUNTED CARDS rather than by the graph —
      // the same order this loop already costs, and the inner `[...listeners]`
      // already pays it per changed node.
      for (const [id, listeners] of [...nodeListeners]) {
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

    /**
     * THE ONE PLACE the selection is written, and therefore the one place the
     * destroyed check belongs — `set`, `toggle`, `clear` and `selectRange` all
     * funnel through here, and guarding four entry points is how three of them
     * stay guarded and the fourth quietly does not.
     *
     * A SILENT NO-OP, not a rejection, matching `markMissing` rather than
     * `dispatch`: these return `void`, so there is nothing to reject WITH, and
     * inventing a throw for an unmount race would be the opposite of what the
     * write doors decided. `dispatch`, `undo`, `redo`, `load` and
     * `applyNonUndoableWrite` all return a `Result` and refuse with
     * `"store-destroyed"`; `markMissing` returns void and simply does not write.
     * Selection is the second of that second kind.
     *
     * It was UNGUARDED, and the argument the write doors make applies unchanged:
     * `destroy()` clears every listener, so a post-destroy `selection.set` moved
     * `selectedIds` and `selectedSet` and then notified an empty set — a zombie
     * write whose only symptom is a later `selection.get()` disagreeing with a
     * UI that has already torn down. Measured: `dispatch` after `destroy()`
     * refused with `"store-destroyed"` while `selection.set([a])` mutated.
     */
    const setSelection = (
      ids: readonly NodeId[],
      nextAnchor: NodeId | null,
    ): void => {
      if (destroyed) return;
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
        // APPLIED BEFORE THE STACK MOVES, and that order is the fix rather than
        // a detail. `history = committed.history` used to run first, so an
        // `applyPatch` that threw left the entry CONSUMED and the graph
        // untouched: the change is gone, and so is the record of how to make
        // it. Computing the next graph first makes the whole call atomic —
        // either the stack moves and the graph moves with it, or neither does
        // and the entry is still there to retry.
        const applied = applyReplayPatch(graph, inverse);
        if (!applied.ok) return applied;

        history = committed.history;

        const at = ctx.now();
        commitGraph(applied.value, "undo");
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
        // Applied before the stack moves, for the reason `undo` gives.
        const applied = applyReplayPatch(graph, forward);
        if (!applied.ok) return applied;

        history = committed.history;

        const at = ctx.now();
        commitGraph(applied.value, "redo");
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

      // THE HISTORY DOOR. ./history has exported these three since it was
      // written — `clearPast` documented as "the only recovery for a dormant
      // entry whose world moved" — and nothing could reach them: `history` is a
      // closure variable and no accessor returns a `History`. A consumer could
      // import the pure function and had nothing to pass it.
      //
      // What that cost: `undo()` deliberately leaves the stack intact when
      // replay is refused, so the entry is not destroyed by a transient
      // failure. But replay is ordered, so a permanently inapplicable entry
      // buries everything under it, `canUndo()` keeps answering true, and the
      // only escape was `destroy()` plus a serialize/deserialize round trip
      // into a fresh store — losing selection and every subscription.
      //
      // THEY NOTIFY GRAPH SUBSCRIBERS, which is not the exception to
      // `SelectionSlice`'s rule that it looks like. There is no history
      // subscription, so `canUndo`/`canRedo` are re-read by graph subscribers,
      // and every history change until now HAS notified them because every one
      // accompanied a commit. These are the first history changes without one;
      // staying silent would leave the stale enabled button that is the whole
      // symptom being cleared. A history slice with its own subscription is the
      // larger, later change — this keeps the existing invariant true.
      //
      // No notify when nothing moved: ./history returns the SAME object when
      // the stack it would clear is already empty, so identity is the test.
      // A destroyed store is a silent no-op, matching the subscribe methods
      // rather than the write ones — there is nothing here to refuse, only
      // state to drop that no one is listening to.
      clearPast() {
        if (destroyed) return;
        const next = historyClearPast(history);
        if (next === history) return;
        history = next;
        notifyAll("graph", graphListeners);
      },
      clearFuture() {
        if (destroyed) return;
        const next = historyClearFuture(history);
        if (next === history) return;
        history = next;
        notifyAll("graph", graphListeners);
      },
      clearHistory() {
        if (destroyed) return;
        const next = historyClearHistory(history);
        if (next === history) return;
        history = next;
        notifyAll("graph", graphListeners);
      },

      /**
       * IO landing. No patch, no history entry, NO change-feed event — the
       * consumer performed the write and already knows about it; echoing it
       * back is how a persistence loop starts.
       */
      applyNonUndoableWrite(edits) {
        // See `dispatch` for why a destroyed store refuses rather than writes.
        if (destroyed) {
          return {
            ok: false,
            error: {
              code: "store-destroyed",
              message: "applyNonUndoableWrite() on a destroyed store.",
            },
          };
        }
        const written = applyNonUndoableWriteEdits(graph, history, edits, ctx);
        if (!written.ok) return written;
        history = written.value.history;
        commitGraph(written.value.graph, "the non-undoable write");
        return { ok: true, value: written.value.scrubbed };
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
        commitGraph(loaded.value.graph, "load");
        // The report is handed BACK rather than swallowed. Seal is a
        // success path, so `ok: true` does not mean the page arrived intact —
        // see `Store.load`.
        return { ok: true, value: loaded.value.report };
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

    // THE AUDIT FIRST, then the bytes. Ordered that way on purpose: computing
    // the document and then discarding it would pay the whole serialize cost
    // for a graph already known to be unwritable.
    serializeChecked: (graph) => {
      const violation = findInvariantViolationIn(graph, registry);
      if (violation !== null) return { ok: false, error: violation };
      return { ok: true, value: serializeGraph(graph, ctx) };
    },

    applyCommand: (graph, command) => applyCommandWithPolicy(graph, command),
    applyPatch: (graph, patch) => applyPatchTo(graph, patch, ctx),
    // THE GATE FIRST, then the rewrite — the order `undo` and `redo` have
    // always used internally, handed to a consumer driving its own replay as
    // one call so the safe order is the one that is easy to write. See
    // `Engine.applyPatch` for what skipping it costs.
    applyPatchChecked: (graph, patch) => {
      const verified = verifyPatchAppliesTo(graph, patch, ctx);
      if (!verified.ok) return verified;
      return applyReplayPatch(graph, patch);
    },
    invertPatch: (patch) => invertPatchOf(patch),
    verifyPatchApplies: (graph, patch) =>
      verifyPatchAppliesTo(graph, patch, ctx),
    findInvariantViolation: (graph) => findInvariantViolationIn(graph, registry),
    resolveDrop: (graph, intent) => resolveDropIn(graph, intent, ctx),

    loadChildren: (graph, id, doc) =>
      loadChildrenInto<Ts, S>(graph, id, doc, ctx),
    markMissing: (graph, id, reason) => markMissingIn(graph, id, reason),
    applyNonUndoableWrite: (graph, history, edits) =>
      applyNonUndoableWriteEdits(graph, history, edits, ctx),

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

