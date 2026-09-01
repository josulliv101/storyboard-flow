"use client";

// Graph React — `createReactBindings(engine)` and everything it closes over.
//
// This is the ONLY module in the package with runtime code, and it is a factory
// rather than a set of module exports for a reason that is not stylistic:
// `createContext` cannot be generic. A module-scope
// `createContext<Store<Ts, S, F> | null>(null)` has nowhere to get `Ts` from, so
// the only thing that compiles up there is an erased context — at which point
// `useNode` hands back `GraphNode<never[], never>` and the consumer's exhaustive
// `switch (node.kind)` has nothing left to switch on. The predecessor has six
// module-scope contexts, including the one carrying its item-content component
// registry, and every one of them erases. Creating them INSIDE a call where `Ts`
// is already bound is what keeps the parameter alive to the call site.
//
// It also has to be a SEPARATE ENTRY POINT from the core, not just a separate
// module. `createEngine` must stay callable from a route handler; the moment the
// factory that produces `deserialize` also produces a Provider, the consumer's
// `export const engine = createEngine(...)` lands in a `"use client"` module, a
// server route imports it, it typechecks clean, and it 500s at request time.
// That is this repo's most expensive bug class and CI is blind to it.
//
// THIS SAID "SEPARATE PACKAGE" AND WAS TRUE WHEN IT DID. The two halves were
// `@storyboard/graph-core` and `@storyboard/graph-react`, and merging them into
// one published package is what makes the distinction worth restating rather
// than deleting: what the argument needs is that importing the core CANNOT pull
// this module into a server graph, and a package boundary was only ever one way
// to get that. The `exports` map is the other. `.` resolves to the core barrel
// and reaches nothing under `react/`; `./react` resolves here. A single barrel
// re-exporting both would put `"use client"` back in the server's path and cost
// exactly what the split package was buying.
//
// Three things hold it up now, and none of them is a convention:
//   - the `exports` map, which gives the core entry no route to this file;
//   - `tsconfig.json` at the package root, which EXCLUDES `react/` and compiles
//     with `lib: ["esnext"]`, so a core file importing React does not build;
//   - `typecheck-packages.mjs`, which checks this half under its own config so
//     that exclusion cannot quietly stop being checked.

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type FunctionComponent,
} from "react";
import {
  getChildren,
  getNode,
  getSubtreeRev,
  type GraphNode,
  type Engine,
  type FoldRegistry,
  type FoldValue,
  type Folded,
  type Graph,
  type KindOf,
  type NodeId,
  type SelectionSlice,
  type Store,
  type WidenedNodeType,
} from "../../core";
import type {
  DispatchFn,
  HistoryControls,
  NodeView,
  ProviderProps,
  SealedView,
  ReactBindings,
} from "./types";

// ---------------------------------------------------------------------------
// The one erasure
// ---------------------------------------------------------------------------

/**
 * A registered view with its `Data` erased, as it is stored in the registry.
 *
 * STILL "ERASED" while the core's equivalent is now `WidenedNodeType`, and the
 * difference is real rather than a missed rename. A concrete
 * `ConsumerDefinedNodeType<"clip", Clip, ClipEdit>` IS assignable to the widened
 * node type — method shorthand keeps it bivariant, and no cast is needed
 * anywhere. `FunctionComponent`'s call signature is a FUNCTION type, so under
 * `strictFunctionTypes` its props parameter is contravariant and
 * `FC<{ data: Clip }>` is genuinely not assignable to `FC<{ data: unknown }>`.
 * That gap can only be crossed by throwing the type away, which is what
 * `eraseNodeView` below does and why it is the only cast in this package.
 *
 * Widening is something the type system permits; erasure is something you do to
 * it. Two words for two operations.
 */
type ErasedNodeView = FunctionComponent<
  Readonly<{ id: NodeId; data: unknown }>
>;

/**
 * THE ONLY CAST IN THIS PACKAGE, and it is the same soundness argument
 * the core's boundary constructors make, one level up.
 *
 * `defineNodeView("clip", ClipCard)` proves at the call site that `ClipCard`
 * takes this kind's `Data`; the registry is a `Map` keyed by a plain string, so
 * that correspondence is compile-time only and the compiler cannot follow it
 * through a lookup. `NodeSlot` re-establishes it by reading `node.kind` off the
 * node the engine parsed — the same discriminant `defineNodeView` was keyed by.
 *
 * The cast cannot be avoided by typing harder: `FunctionComponent`'s call
 * signature is a FUNCTION type, not a method, so under `strictFunctionTypes` its
 * props parameter is contravariant and `FC<{ data: Clip }>` is genuinely not
 * assignable to `FC<{ data: unknown }>`. Through `unknown`, never `any`.
 */
function eraseNodeView<Ts extends readonly WidenedNodeType[], K extends string>(
  view: NodeView<Ts, K>,
): ErasedNodeView {
  return view as unknown as ErasedNodeView;
}

// ---------------------------------------------------------------------------
// createReactBindings
// ---------------------------------------------------------------------------

/**
 * Bind React to one engine.
 *
 * `Ts`, `S` and `F` are inferred from `typeof engine` — the consumer writes
 * `createReactBindings(engine)` and never restates the registry tuple.
 *
 * Call it ONCE per engine, at module scope, and export the result. Calling it
 * twice produces two independent contexts and two independent view registries,
 * and a component that reads from one while its Provider came from the other
 * throws the "must be used inside the Provider" error with no other clue.
 */
export function createReactBindings<
  Ts extends readonly WidenedNodeType[],
  S,
  F extends FoldRegistry<Ts, S>,
>(engine: Engine<Ts, S, F>): ReactBindings<Ts, S, F> {
  type BoundStore = Store<Ts, S, F>;

  // Non-exported and created HERE, where `Ts` is bound. See the module header.
  const StoreContext = createContext<BoundStore | null>(null);

  const nodeViews = new Map<string, ErasedNodeView>();
  let sealedView: SealedView | null = null;

  /**
   * Kinds already reported as having no registered view.
   *
   * Two jobs. It keeps a missing view from logging once per render per card,
   * which is thousands of lines for one typo; and a `defineNodeView` for a kind
   * already in here is PROVABLY a late registration, which is a different bug
   * with a different fix and worth saying so.
   */
  const reportedMissingKinds = new Set<string>();

  /** One diagnostic per store, not one per render. */
  const auditedStores = new WeakSet<BoundStore>();

  // -------------------------------------------------------------------------
  // Provider and the store handle
  // -------------------------------------------------------------------------

  const Provider: FunctionComponent<ProviderProps<Ts, S, F>> = ({
    store,
    children,
  }) => {
    // `NodeId` is branded GLOBALLY, not per engine, so a store built by a
    // different engine typechecks here and then quietly serves that engine's
    // nodes to these views. the core covers the mutating paths with an
    // `engineId` check; reads are unchecked because they are the hot path, and
    // this is the one place a React consumer can be told cheaply.
    if (!auditedStores.has(store)) {
      auditedStores.add(store);
      if (store.getGraph().engineId !== engine.engineId) {
        console.error(
          "graph: this store's graph was built by a different engine than the one these bindings were created from. Reads will not be checked and the views will be handed foreign nodes.",
        );
      }
    }
    return (
      <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
    );
  };
  Provider.displayName = "KeelProvider";

  function useStore(): BoundStore {
    const store = useContext(StoreContext);
    if (store === null) {
      // THROWN, not Result-shaped, and that is not an inconsistency with
      // the core: every `Rejection` there names something a consumer can act on
      // at runtime. A missing Provider is a wiring mistake in the component
      // tree, it is true on every render forever, and there is no useful value
      // to hand back.
      throw new Error(
        "graph: hooks must be used inside the Provider returned by createReactBindings(engine).",
      );
    }
    return store;
  }

  // -------------------------------------------------------------------------
  // The subscription primitive
  // -------------------------------------------------------------------------

  /**
   * Every node-scoped hook is this function.
   *
   * SUBSCRIPTION: `store.subscribeToNode(id)`, which fires when that node's
   * `subtreeRev` changes — one counter doing both jobs, invalidation and
   * notification. It is bumped along the ancestor chain by every mutation,
   * hydration and non-undoable writes included, which closes the predecessor's hole where a
   * move at depth 5 changed no ancestor's children-array identity and therefore
   * re-rendered no ancestor's rollup, ever.
   *
   * SNAPSHOT STABILITY is the subtle half and it is load-bearing.
   * `useSyncExternalStore` calls `getSnapshot` on every render and throws "The
   * result of getSnapshot should be cached" — an infinite render loop in
   * practice — if two consecutive calls return values that are not
   * `Object.is`-equal. Several of the selectors below build a fresh object per
   * call (`store.aggregate` re-wraps its `Folded` even on a cache hit), so the
   * memoised closure here is what makes them usable at all.
   *
   * The cache is keyed on GRAPH IDENTITY rather than on `subtreeRev`, which
   * looks like the more precise choice and is not. the core documents a
   * residual in `applyInserted`: removing a node drops its rev entry, so
   * re-inserting the same id RESTARTS it from 0, and a rev-keyed cache would
   * serve the pre-removal value after a remove-then-redo. Graph identity has no
   * such hole — the graph is replaced wholesale on every commit — and the cost
   * of the extra misses is one map lookup, or one hit in the store's own
   * rev-keyed fold cache.
   *
   * `select` must be referentially stable; every caller below wraps it in
   * `useCallback` with its real dependencies, and it is a dependency of the
   * memo so a changed one rebuilds the closure with an empty cache.
   */
  function useNodeSlice<T>(id: NodeId, select: (store: BoundStore) => T): T {
    const store = useStore();

    const [subscribe, getSnapshot] = useMemo(() => {
      let cached: Readonly<{ graph: Graph<Ts, S>; value: T }> | undefined;

      const read = (): T => {
        const graph = store.getGraph();
        if (cached !== undefined && cached.graph === graph) return cached.value;
        const value = select(store);
        cached = { graph, value };
        return value;
      };

      const listen = (onStoreChange: () => void): (() => void) =>
        store.subscribeToNode(id, onStoreChange);

      return [listen, read] as const;
    }, [store, id, select]);

    // The server snapshot is the same function. The graph is a pure value that
    // is fully available synchronously, so there is nothing for an SSR pass to
    // do differently — and omitting it makes React throw on the server render
    // Next performs for every client component.
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  /** The graph-wide equivalent, for the two hooks that are not node-scoped. */
  function useGraphSlice<T>(select: (store: BoundStore) => T): T {
    const store = useStore();

    const [subscribe, getSnapshot] = useMemo(() => {
      const listen = (onStoreChange: () => void): (() => void) =>
        store.subscribeToGraph(onStoreChange);
      return [listen, () => select(store)] as const;
    }, [store, select]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  // -------------------------------------------------------------------------
  // Node-scoped hooks
  // -------------------------------------------------------------------------

  function useSubtreeRev(id: NodeId): number {
    const select = useCallback(
      (store: BoundStore) => getSubtreeRev(store.getGraph(), id),
      [id],
    );
    return useNodeSlice(id, select);
  }

  function useNode(id: NodeId): GraphNode<Ts, S> | undefined {
    const select = useCallback(
      (store: BoundStore) => getNode(store.getGraph(), id),
      [id],
    );
    // A node object's identity survives a descendant's change: `bumpSubtreeRevs`
    // rewrites `subtreeRevById` and nothing else, so an ancestor subscribed here
    // is woken by a deep edit, reads the identical node back, and React skips
    // the re-render. Woken-but-unchanged is the correct outcome — the ancestor
    // is exactly who needs waking when it also holds a `useFold`.
    return useNodeSlice(id, select);
  }

  function useChildren(id: NodeId): readonly NodeId[] {
    const select = useCallback(
      (store: BoundStore) => getChildren(store.getGraph(), id),
      [id],
    );
    return useNodeSlice(id, select);
  }

  function useFold<K extends keyof F>(
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined {
    // `store.aggregate`, NOT `engine.aggregate`. The engine's is deliberately
    // uncached because it accepts an arbitrary graph, at which point
    // `(foldKey, nodeId, subtreeRev)` no longer identifies content and a hit
    // would be silently wrong rather than merely stale. The store owns a single
    // lineage and is the cached one.
    const select = useCallback(
      (store: BoundStore) => store.aggregate(key, id),
      [key, id],
    );
    return useNodeSlice(id, select);
  }

  // -------------------------------------------------------------------------
  // Graph-scoped hooks
  // -------------------------------------------------------------------------

  const selectGraph = (store: BoundStore): Graph<Ts, S> => store.getGraph();
  const selectRoots = (store: BoundStore): readonly NodeId[] =>
    store.getGraph().rootIds;

  function useGraph(): Graph<Ts, S> {
    // `getGraph()` is identity-stable between commits, so this needs no memo
    // cache of its own — the selector IS the identity.
    return useGraphSlice(selectGraph);
  }

  function useRoots(): readonly NodeId[] {
    // `rootIds` survives every mutation path by reference: patches only ever
    // touch parented nodes, and every rewriter spreads the previous graph. If
    // that ever stops being true this hook degrades to re-rendering on every
    // commit — noisy, not wrong.
    return useGraphSlice(selectRoots);
  }

  // -------------------------------------------------------------------------
  // Dispatch and history
  // -------------------------------------------------------------------------

  function useDispatch(): DispatchFn<Ts, S> {
    const store = useStore();
    return useCallback(
      (command, options) => store.dispatch(command, options),
      [store],
    );
  }

  function useHistory(): HistoryControls<Ts, S> {
    const store = useStore();

    const subscribe = useCallback(
      (onStoreChange: () => void): (() => void) => {
        // BOTH feeds, and both are needed. `dispatch` / `undo` / `redo` move the
        // stacks and emit on the change feed; `applyNonUndoableWrite` also moves
        // them — it
        // SCRUBS entries out of both — and emits nothing there by design, since
        // echoing an IO write back to the consumer that just performed it is how
        // a persistence loop starts. Its only signal is the graph commit.
        const offGraph = store.subscribeToGraph(onStoreChange);
        const offChanges = store.subscribeToChanges(onStoreChange);
        return () => {
          offGraph();
          offChanges();
        };
      },
      [store],
    );

    // Two separate subscriptions over two BOOLEANS rather than one over a
    // `{ canUndo, canRedo }` object: an object literal is a fresh reference per
    // call, which is the "getSnapshot should be cached" loop again.
    //
    // The cost is four listeners per mounted `useHistory` (two feeds x two
    // flags) where a bitfield snapshot would need two. Paid deliberately: a
    // toolbar is mounted once, and `(canUndo ? 1 : 0) | (canRedo ? 2 : 0)` is
    // the kind of clever that gets read wrong later.
    const readUndo = useCallback(() => store.canUndo(), [store]);
    const readRedo = useCallback(() => store.canRedo(), [store]);
    const canUndo = useSyncExternalStore(subscribe, readUndo, readUndo);
    const canRedo = useSyncExternalStore(subscribe, readRedo, readRedo);

    return useMemo(
      () => ({
        canUndo,
        canRedo,
        undo: () => store.undo(),
        redo: () => store.redo(),
      }),
      [store, canUndo, canRedo],
    );
  }

  // -------------------------------------------------------------------------
  // Selection — its own slice, its own subscription
  // -------------------------------------------------------------------------
  //
  // A selection change must NOT notify graph subscribers, and a graph change
  // that prunes the selection MUST notify selection ones. the core owns both
  // halves; these hooks only have to keep the two feeds apart, which they do by
  // never touching `subscribeToGraph`.

  function useSelectionSlice<T>(select: (selection: SelectionSlice) => T): T {
    const store = useStore();

    const [subscribe, getSnapshot] = useMemo(() => {
      const listen = (onStoreChange: () => void): (() => void) =>
        store.selection.subscribe(onStoreChange);
      return [listen, () => select(store.selection)] as const;
    }, [store, select]);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  const selectSelectedIds = (selection: SelectionSlice): readonly NodeId[] =>
    // Identity-stable: the core only reassigns the array when the set actually
    // changed, so this needs no memo cache.
    selection.get();
  const selectAnchor = (selection: SelectionSlice): NodeId | null =>
    selection.anchor();

  function useSelection(): readonly NodeId[] {
    return useSelectionSlice(selectSelectedIds);
  }

  function useIsSelected(id: NodeId): boolean {
    const select = useCallback(
      (selection: SelectionSlice) => selection.has(id),
      [id],
    );
    return useSelectionSlice(select);
  }

  function useSelectionAnchor(): NodeId | null {
    return useSelectionSlice(selectAnchor);
  }

  function useSelectionActions(): SelectionSlice {
    // The slice object is created once per store and its methods close over
    // store state, so this is stable and never a render trigger on its own.
    return useStore().selection;
  }

  // -------------------------------------------------------------------------
  // Per-kind views
  // -------------------------------------------------------------------------

  function defineNodeView<K extends KindOf<Ts>>(
    kind: K,
    view: NodeView<Ts, K>,
  ): void {
    if (nodeViews.has(kind)) {
      console.error(
        `graph: a view for kind "${kind}" is already registered; the later registration wins. Two modules registering one kind means whichever imports last decides what renders.`,
      );
    } else if (reportedMissingKinds.has(kind)) {
      // NodeSlot already tried to render this kind and found nothing, so this
      // registration is provably late. Different bug, different fix: move the
      // call to module scope. Already-mounted slots do not re-render for it.
      console.error(
        `graph: the view for kind "${kind}" was registered AFTER a node of that kind rendered. Register views at module scope — the registry is read during render and a late registration does not re-render mounted slots.`,
      );
    }

    const erased = eraseNodeView<Ts, K>(view);
    // `react/display-name` is an ERROR in this repo and fails the Vercel build
    // while tsc and vitest stay green, so anything that can reach the tree gets
    // a name. A name the consumer set wins — theirs is the more specific one.
    if (erased.displayName === undefined || erased.displayName === "") {
      erased.displayName = `KeelNodeView(${kind})`;
    }
    nodeViews.set(kind, erased);
    reportedMissingKinds.delete(kind);
  }

  function defineSealedView(view: SealedView): void {
    if (view.displayName === undefined || view.displayName === "") {
      view.displayName = "KeelSealedView";
    }
    sealedView = view;
  }

  /**
   * Props are `{ id }` and nothing else.
   *
   * That is what makes `memo` work here where it did not in the predecessor:
   * there is no render prop for a parent's re-render to hand in fresh, and the
   * component being memoised is non-generic, so `memo` has no type parameter to
   * erase. Every per-kind view is an ordinary named component looked up by the
   * same `kind` discriminant the engine parsed the node with.
   */
  const NodeSlotInner: FunctionComponent<Readonly<{ id: NodeId }>> = ({
    id,
  }) => {
    const node = useNode(id);

    // Routine, not exceptional: a card can outlive its node by a frame, and a
    // removal that rendered a "missing node" box would flash one on every
    // delete.
    if (node === undefined) return null;

    // Discriminate on `sealed` FIRST. `container` cannot do it — on the
    // sealed arm it is a plain `boolean` off the wire, so it is not
    // disjoint from the `true` / `false` literals on the other two arms.
    if (node.sealed) {
      if (sealedView === null) return null;
      const Sealed = sealedView;
      return <Sealed id={id} node={node} />;
    }

    const View = nodeViews.get(node.kind);
    if (View === undefined) {
      if (!reportedMissingKinds.has(node.kind)) {
        reportedMissingKinds.add(node.kind);
        console.error(
          `graph: no view registered for kind "${node.kind}". Call defineNodeView("${node.kind}", ...) at module scope.`,
        );
      }
      return null;
    }
    return <View id={id} data={node.data} />;
  };
  NodeSlotInner.displayName = "KeelNodeSlotInner";

  const NodeSlot = memo(NodeSlotInner);
  NodeSlot.displayName = "KeelNodeSlot";

  return {
    Provider,
    useStore,
    useGraph,
    useRoots,
    useSubtreeRev,
    useNode,
    useChildren,
    useFold,
    // Same function, both names. the core sets the precedent with
    // `ValueOf` / `FoldValue`: the spec's name stays callable, and there is one
    // implementation rather than a wrapper that can drift from it.
    useAggregate: useFold,
    useDispatch,
    useHistory,
    useSelection,
    useIsSelected,
    useSelectionAnchor,
    useSelectionActions,
    defineNodeView,
    defineSealedView,
    NodeSlot,
  };
}
