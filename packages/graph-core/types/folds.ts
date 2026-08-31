// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { CollectionNode, LeafNode, QuarantinedNode } from "./graph";
import type { WidenedNodeType } from "./node-types";
import type { NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 8. Folds — derived aggregates
// ---------------------------------------------------------------------------

export type Certainty = "exact" | "estimated" | "partial";

/**
 * A UNION, not a flat `{ value; certainty: Certainty }` — a correction to the
 * spec's published shape, made because I compiled both.
 *
 * The persistence gate is `summaryFrom(f: ExactFolded<A>)`. With a flat
 * object, `Extract<Folded<A>, { certainty: "exact" }>` evaluates to `never`
 * (nothing to extract from a non-union), and `if (f.certainty === "exact")`
 * narrows the PROPERTY but not the object — so the gate cannot be called at
 * all and the whole mechanism is dead code. As a union, both work.
 *
 * It costs fold authors nothing: TypeScript distributes an object over a
 * discriminated-union target, so `{ value, certainty }` with a computed
 * `Certainty` still assigns (verified, fresh literal and pre-typed variable
 * alike).
 */
export type Folded<A> =
  | Readonly<{ value: A; certainty: "exact" }>
  | Readonly<{ value: A; certainty: "estimated" }>
  | Readonly<{ value: A; certainty: "partial" }>;

/** The only member `summaryFrom` accepts. */
export type ExactFolded<A> = Extract<Folded<A>, { certainty: "exact" }>;

/** A child's folded value plus the two facts a position-sensitive parent needs. */
export type FoldedChild<A> = Folded<A> &
  Readonly<{
    id: NodeId;
    /** `true` for `unloaded` / `reference` — the child is a stand-in, and its
     *  POSITION in the list is what decides whether that matters. */
    placeholder: boolean;
  }>;

/**
 * NOT a monoid. Three independent lines of evidence killed the monoid and the
 * decisive one was measured:
 *
 *  - `measure(data) => A` cannot express a subtree VETO (a container's own
 *    `disabled` flag dropping its whole subtree) or an empty-collection FLOOR,
 *    because by the time `concat` runs the vetoed subtree is already summed in
 *    and indistinguishable.
 *  - Weakest-wins certainty is position-blind, and the real rule is
 *    position-SENSITIVE: an unloaded branch AFTER the first media leaves the
 *    result correct, so the live answer still wins. Weakest-wins would discard
 *    a perfectly good live result — and with it a just-made edit — in favour
 *    of the stored summary.
 *  - A realistic `previews` monoid violates its own laws the moment a pending
 *    value is an unbounded array: `concat(empty, x)` truncates, `concat(x,
 *    empty)` does not.
 *
 * `collection` sees its own data (veto), the ORDERED children with each one's
 * certainty and `placeholder` flag (position-sensitivity), and
 * `children.length === 0` explicitly (the floor). All four expressible.
 *
 * GRAPH-BLIND is the load-bearing invariant, not a convenience: a node's value
 * depends only on its own data and its children's values, which is what makes
 * "invalidate the changed nodes and their ancestor chains" provably
 * sufficient. A fold handed the graph would make "drop everything" the only
 * correct invalidation.
 *
 * Method shorthand for the same reason as `ConsumerDefinedNodeType`: `children` is a
 * PARAMETER mentioning `A`, so arrow properties would sink the
 * `ConsumerDefinedFold<Ts, S, unknown>` registry constraint.
 */
export type ConsumerDefinedFold<Ts extends readonly WidenedNodeType[], S, A> = Readonly<{
  key: string;
  /** A leaf is always `"exact"` — only placeholders and quarantine introduce
   *  uncertainty, so the evaluator wraps this without asking. */
  leaf(node: LeafNode<Ts>): A;
  collection(
    node: CollectionNode<Ts, S>,
    children: readonly FoldedChild<A>[],
  ): Folded<A>;
  /** `unloaded` | `reference`. Reads `node.summary`. */
  placeholder(node: CollectionNode<Ts, S>): Folded<A>;
  /** MUST return certainty `"exact"`: confirmed-gone is knowledge. */
  missing(node: CollectionNode<Ts, S>): Folded<A>;
  /** REQUIRED — no default. Forward-incompatible data must be answered for. */
  quarantined(node: QuarantinedNode): Folded<A>;
}>;

/**
 * A fold with its `A` widened away — the `WidenedNodeType` of this section, and
 * widened for the same reason: one `FoldRegistry` holds folds that answer
 * different questions, so the value type cannot survive the container.
 *
 * `makeFolded` is the boundary constructor that crosses back, and `computeFold`
 * can only ever return `Folded<unknown>` while `aggregate<K>` promises
 * `Folded<FoldValue<F[K]>>`.
 */
export type WidenedFold<Ts extends readonly WidenedNodeType[], S> = ConsumerDefinedFold<Ts, S, unknown>;

export type FoldRegistry<Ts extends readonly WidenedNodeType[], S> = Readonly<
  Record<string, WidenedFold<Ts, S>>
>;

/** The `A` of a fold — `Folded<FoldValue<F["duration"]>>` is what `aggregate`
 *  returns. */
export type FoldValue<X> = X extends ConsumerDefinedFold<
  infer _Ts extends readonly WidenedNodeType[],
  infer _S,
  infer A
>
  ? A
  : never;

/** Spec-compat alias for `FoldValue`. */
export type ValueOf<X> = FoldValue<X>;

/**
 * Cache slot keyed by `(foldKey, nodeId, subtreeRev)`. A stale entry is
 * therefore UNREACHABLE rather than wrong, which is what lets this be a plain
 * LRU beside the store while `Graph` stays a pure value.
 *
 * `get` returns a hit/miss union rather than `unknown | undefined` — those
 * collapse to `unknown`, and a legitimately-cached `undefined` would be
 * indistinguishable from a miss.
 */
/**
 * What a fold cache will tell you about itself.
 *
 * DECLARED HERE, not in ./folds, and that is the correction rather than a
 * preference. This shape used to live in ./folds and be hand-copied into
 * `EngineConfig.onFoldCacheStats`'s parameter, on the argument that "this module
 * is the base of the package and imports nothing, so a types -> folds edge would
 * be a cycle." The premise is true and the conclusion did not follow: the fix is
 * the other direction. `FoldCache` directly below has always lived here and been
 * imported BY ./folds, which is the same relationship — so this can be too, and
 * the two copies that "must stay identical" become one that cannot drift.
 *
 * `hits` / `misses` / `evictions` are LIFETIME counts and survive `clear()`;
 * `size` is current occupancy.
 */
export type FoldCacheStats = Readonly<{
  /** Lifetime `get` calls answered from the table. */
  hits: number;
  /** Lifetime `get` calls that had to fold. */
  misses: number;
  /**
   * Entries dropped FOR CAPACITY, and only for capacity. `clear()` is not
   * counted: conflating a deliberate reset with cache pressure would destroy
   * the only number that says the limit is too low.
   */
  evictions: number;
  /** Entries held right now. */
  size: number;
  /** The EFFECTIVE ceiling after flooring and the non-finite fallback, not the
   *  raw constructor argument. */
  limit: number;
}>;

export type FoldCache = Readonly<{
  get(
    foldKey: string,
    nodeId: NodeId,
    subtreeRev: number,
  ): Readonly<{ hit: true; value: unknown }> | Readonly<{ hit: false }>;
  set(foldKey: string, nodeId: NodeId, subtreeRev: number, value: unknown): void;
  clear(): void;
  size(): number;
}>;
