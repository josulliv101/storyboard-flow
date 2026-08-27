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

function defaultMintId(): string {
  mintCounter += 1;
  return `keel-${mintCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
 * Build the engine. THROWS on a duplicate `kind` (via `buildRegistry`) and on
 * nothing else, ever — a duplicate is a programmer error at module init, before
 * any data has been read, and there is no partial-success answer worth
 * returning when the consumer's own module graph is wrong.
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

    // Handed out here, before the store exists and before any fold can run, so
    // a consumer that wants the counters has them from the first `aggregate`
    // rather than from whenever it next remembered to ask.
    config.onFoldCacheStats?.(() => cache.stats());

    const nodeListeners = new Map<NodeId, Set<() => void>>();
    const graphListeners = new Set<() => void>();
    const changeListeners = new Set<(change: Change<Ts, S>) => void>();
    const selectionListeners = new Set<() => void>();

    let selectedIds: readonly NodeId[] = [];
    let anchorId: NodeId | null = null;
    let destroyed = false;

    const notifyAll = (listeners: ReadonlySet<() => void>): void => {
      // Copied before iterating: a listener that unsubscribes itself (the
      // normal React teardown) mutates the set mid-iteration otherwise.
      for (const listener of [...listeners]) listener();
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

      const selectionChanged = pruneSelection();

      // Only SUBSCRIBED ids are compared, so this is O(mounted cards) rather
      // than O(graph). Reading through `getSubtreeRev` (0 for an unknown node)
      // is what makes a removal and an insertion both register as a change.
      for (const [id, listeners] of nodeListeners) {
        if (getSubtreeRev(previous, id) === getSubtreeRev(next, id)) continue;
        for (const listener of [...listeners]) listener();
      }

      notifyAll(graphListeners);
      // A selection change must never notify graph subscribers; the reverse —
      // a graph change pruning the selection — must notify selection ones.
      if (selectionChanged) notifyAll(selectionListeners);
    };

    const emitChange = (change: Change<Ts, S>): void => {
      for (const listener of [...changeListeners]) listener(change);
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
      anchorId = resolvedAnchor;
      notifyAll(selectionListeners);
    };

    const selection: SelectionSlice = {
      get: () => selectedIds,
      has: (id) => selectedIds.includes(id),
      set: (ids) => {
        setSelection(ids, ids.at(-1) ?? null);
      },
      toggle: (id) => {
        if (!selectedIds.includes(id)) {
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
        const ingested = applyIngestEdits(graph, history, edits, ctx);
        if (!ingested.ok) return ingested;
        history = ingested.value.history;
        commitGraph(ingested.value.graph, "ingest");
        return { ok: true, value: ingested.value.scrubbed };
      },

      load(id, doc) {
        const loaded = loadChildrenInto<Ts, S>(graph, id, doc, ctx);
        if (!loaded.ok) return loaded;
        commitGraph(loaded.value, "load");
        return { ok: true, value: undefined };
      },

      markMissing(id, reason) {
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
