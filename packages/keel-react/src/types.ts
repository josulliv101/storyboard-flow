// KEEL React — the shapes `createReactBindings` hands back.
//
// Split out of ./bindings.tsx for one reason: a consumer that wants to annotate
// the value it stores (`const ui: ReactBindings<...> = createReactBindings(e)`)
// or the components it registers should not have to import a `.tsx` module to
// do it. Nothing here has a runtime representation.
//
// Every member below is METHOD SHORTHAND, matching keel-core's `NodeType` and
// `Fold`. There it is load-bearing (bivariance is what lets the registry
// constraint be written with `unknown` and no `any`); here it is merely
// consistent, and consistency is worth something when the two packages are read
// side by side.

import type { FunctionComponent, NamedExoticComponent, ReactNode } from "react";
import type {
  GraphNode,
  Command,
  DataForKind,
  FoldRegistry,
  FoldValue,
  Folded,
  Graph,
  KindOf,
  NodeId,
  Patch,
  QuarantinedNode,
  Rejection,
  ReplayRejection,
  Result,
  SelectionSlice,
  Store,
} from "@storyboard/keel-core";

// ---------------------------------------------------------------------------
// Per-kind views
// ---------------------------------------------------------------------------

/**
 * What a registered per-kind view receives.
 *
 * `id` AND `data`, not just `id`: `data` spares every view its own `useNode`
 * call, and `id` is what it needs to dispatch an edit or read a fold about
 * itself. A view that wants its children calls `useChildren(id)`.
 */
export type NodeViewProps<
  Ts extends readonly unknown[],
  K extends string,
> = Readonly<{
  id: NodeId;
  data: DataForKind<Ts, K>;
}>;

/**
 * An ORDINARY, non-generic component — which is the whole point.
 *
 * The predecessor's per-item content components were generic, so `memo()` had a
 * type parameter to erase and the memo boundary quietly stopped being typed.
 * Here the generic lives on `defineNodeView`, the registration function; what
 * lands in the registry is a concrete component with concrete props, and
 * `NodeSlot` — which takes `{ id }` and nothing else — is the only thing
 * `memo()` ever sees.
 */
export type NodeView<
  Ts extends readonly unknown[],
  K extends string,
> = FunctionComponent<NodeViewProps<Ts, K>>;

/**
 * The fallback for forward-incompatible data. `QuarantinedNode` is not generic
 * (there is no node type, so there is no `Data`), so neither is this.
 *
 * Registering one is optional; without it a quarantined node renders nothing.
 * That is a deliberate default rather than a placeholder box: the engine
 * guarantees the node is still movable, removable and re-emitted byte-exact,
 * and inventing a visual for it is a product decision keel cannot make.
 */
export type QuarantinedViewProps = Readonly<{
  id: NodeId;
  node: QuarantinedNode;
}>;

export type QuarantinedView = FunctionComponent<QuarantinedViewProps>;

// ---------------------------------------------------------------------------
// Hook return shapes
// ---------------------------------------------------------------------------

/**
 * Undo/redo state and actions in one object.
 *
 * `canUndo` / `canRedo` are the sanctioned pre-checks: `undo()` on an empty
 * stack is a `Result` rejection, not a throw, but a disabled button beats a
 * rejection nobody reads.
 */
export type HistoryControls<Ts extends readonly unknown[], S> = Readonly<{
  canUndo: boolean;
  canRedo: boolean;
  undo(): Result<Patch<Ts, S>, ReplayRejection>;
  redo(): Result<Patch<Ts, S>, ReplayRejection>;
}>;

export type DispatchFn<Ts extends readonly unknown[], S> = (
  command: Command<Ts, S>,
  options?: Readonly<{ coalesceKey?: string }>,
) => Result<Patch<Ts, S>, Rejection>;

export type ProviderProps<
  Ts extends readonly unknown[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  store: Store<Ts, S, F>;
  children?: ReactNode;
}>;

// ---------------------------------------------------------------------------
// The factory's return value
// ---------------------------------------------------------------------------

/**
 * Everything `createReactBindings(engine)` produces.
 *
 * WHY THIS IS A RETURN VALUE AND NOT A SET OF MODULE EXPORTS: `createContext`
 * cannot be generic. A module-scope `createContext<Store<Ts, S, F> | null>` has
 * nowhere to get `Ts` from, so the only thing that compiles at module scope is
 * an erased context — at which point `useNode` returns `GraphNode<never[], never>`
 * and every consumer's exhaustive `switch (node.kind)` has nothing to switch on.
 * Creating the contexts INSIDE a call where `Ts` is already bound is what keeps
 * the parameter alive all the way to the call site.
 *
 * The honest cost, stated so nobody rediscovers it as a bug: this package ships
 * no pre-made components, and none of the React layer tree-shakes — every hook
 * is reachable from the one returned object.
 */
export type ReactBindings<
  Ts extends readonly unknown[],
  S,
  F extends FoldRegistry<Ts, S>,
> = Readonly<{
  /** Publishes one store to the subtree. Everything else throws without it. */
  Provider: FunctionComponent<ProviderProps<Ts, S, F>>;

  /** The store itself — for imperative work (`load`, `ingest`, `resolveDrop`). */
  useStore(): Store<Ts, S, F>;

  /**
   * The whole graph, re-rendering on EVERY commit anywhere.
   *
   * A last resort, and named as one. `useNode` / `useChildren` / `useFold`
   * subscribe per node, which is the entire reason `subtreeRev` exists; a
   * component holding this one re-renders when a sibling three subtrees away
   * gets a thumbnail.
   */
  useGraph(): Graph<Ts, S>;

  /** The root list. Re-renders only when the roots themselves change. */
  useRoots(): readonly NodeId[];

  /**
   * This node's subtree revision — a primitive, and the counter every other
   * node-scoped hook is subscribed to underneath. Useful as a dependency for a
   * consumer's own memo over a subtree.
   */
  useSubtreeRev(id: NodeId): number;

  /** `undefined` when the node is gone — routine, a card can outlive its node
   *  by a frame. */
  useNode(id: NodeId): GraphNode<Ts, S> | undefined;

  /**
   * `[]` for anything that is not a LOADED collection.
   *
   * DO NOT READ THIS TO DECIDE "IS IT EMPTY" — an unloaded collection and a
   * genuinely empty one both answer `[]`, and collapsing those two is the exact
   * ambiguity the four-state `ChildrenState` exists to remove. Read
   * `useNode(id)` and look at `children.status`.
   */
  useChildren(id: NodeId): readonly NodeId[];

  /** A registered fold over this node's subtree. `undefined` when the node is
   *  gone or the key names no fold. */
  useFold<K extends keyof F>(
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;

  /** Spec-compat alias for `useFold`. Identical implementation. */
  useAggregate<K extends keyof F>(
    key: K,
    id: NodeId,
  ): Folded<FoldValue<F[K]>> | undefined;

  /** Stable for the lifetime of the store, so it is safe in a dependency list. */
  useDispatch(): DispatchFn<Ts, S>;

  useHistory(): HistoryControls<Ts, S>;

  /** The selected ids, in the order they were selected. */
  useSelection(): readonly NodeId[];

  /**
   * A BOOLEAN, per card. The array from `useSelection` changes identity on every
   * selection change, so a card subscribed to it re-renders when an unrelated
   * card is clicked; this one returns a primitive that `Object.is`-compares
   * equal, and React skips the re-render.
   */
  useIsSelected(id: NodeId): boolean;

  useSelectionAnchor(): NodeId | null;

  /** The mutating half of the selection slice. Stable — never a render trigger. */
  useSelectionActions(): SelectionSlice;

  /**
   * Register the component for one kind. CALL AT MODULE SCOPE, before the first
   * render: the registry is read during render and a late registration does not
   * re-render already-mounted slots.
   */
  defineNodeView<K extends KindOf<Ts>>(kind: K, view: NodeView<Ts, K>): void;

  defineQuarantinedView(view: QuarantinedView): void;

  /**
   * Props are `{ id }` and NOTHING else.
   *
   * No render prop, no children, no `data` passed down — so there is nothing a
   * parent's re-render can hand in that defeats `memo`, and the component
   * `memo` wraps is non-generic so there is no type parameter to erase.
   *
   * `NamedExoticComponent`, not the spec's `MemoExoticComponent<FC<…>>`:
   * @types/react resolves `memo(fn)` against its `FunctionComponent` overload,
   * which returns `NamedExoticComponent<P>` and carries no `type` field.
   * Declaring the spec's shape does not compile. Both are memoised; the
   * difference is only whether the wrapped component is reachable as `.type`,
   * which nothing here needs.
   */
  NodeSlot: NamedExoticComponent<Readonly<{ id: NodeId }>>;
}>;
