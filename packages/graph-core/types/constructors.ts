// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { Folded } from "./folds";
import type { ChildrenState, CollectionNode, LeafNode, QuarantineReason, QuarantinedNode } from "./graph";
import type { WidenedNodeType } from "./node-types";
import type { DataChange } from "./patches";
import type { Issue, NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 11. Boundary constructors
// ---------------------------------------------------------------------------
//
// FOUR functions, and they are the ONLY place in graph-core where a cast is
// permitted.
//
// The soundness argument is the same for all four and worth stating once: the
// caller has just looked a node type up in the registry — where it is erased to
// `ConsumerDefinedNodeType<string, unknown, unknown>` — and run its `parse`. The value in hand
// IS that kind's `Data`; the compiler simply cannot see through the erasure to
// prove it, because the registry is a `Map` and the mapped tuple is a
// compile-time-only correspondence.
//
// Concentrating that step here means the other seven modules construct nodes
// with no cast at all, and there is exactly one place to look when a node comes
// out shaped wrong. Casts go through `unknown`, never `any`.

/** Build a leaf whose `data` has already been through `parse`. */
export function makeLeafNode<Ts extends readonly WidenedNodeType[]>(
  id: NodeId,
  kind: string,
  data: unknown,
): LeafNode<Ts> {
  const node: Readonly<{
    id: NodeId;
    quarantined: false;
    container: false;
    kind: string;
    data: unknown;
  }> = { id, quarantined: false, container: false, kind, data };
  return node as unknown as LeafNode<Ts>;
}

/** Build a collection whose `data` has already been through `parse`. */
export function makeCollectionNode<Ts extends readonly WidenedNodeType[], S>(
  id: NodeId,
  kind: string,
  data: unknown,
  children: ChildrenState,
  summary: S | null,
): CollectionNode<Ts, S> {
  const node: Readonly<{
    id: NodeId;
    quarantined: false;
    container: true;
    kind: string;
    data: unknown;
    children: ChildrenState;
    summary: S | null;
  }> = {
    id,
    quarantined: false,
    container: true,
    kind,
    data,
    children,
    summary,
  };
  return node as unknown as CollectionNode<Ts, S>;
}

/**
 * A quarantined node needs no cast — `QuarantinedNode` is not generic, since
 * there is no node type and therefore no `Data`. Present for symmetry, and to keep
 * `raw` construction in one place: `raw` MUST be the value exactly as it
 * arrived, or re-emit stops being byte-exact.
 */
export function makeQuarantinedNode(
  args: Readonly<{
    id: NodeId;
    kind: string;
    container: boolean;
    schemaVersion: number;
    raw: unknown;
    reason: QuarantineReason;
    issues: readonly Issue[];
    children: ChildrenState | null;
    summary: unknown;
  }>,
): QuarantinedNode {
  return { quarantined: true, ...args };
}

/**
 * Re-brand a `Folded<unknown>` as the fold's own value type.
 *
 * Same erasure argument as the node constructors, one level up: `FoldRegistry`
 * is `Record<string, ConsumerDefinedFold<Ts, S, unknown>>`, so a fold looked up by key has
 * already lost its `A` — `computeFold` can only return `Folded<unknown>`, while
 * `aggregate<K>` promises `Folded<FoldValue<F[K]>>`. The correspondence between
 * the key and the fold's `A` is real but compile-time only, exactly as with a
 * kind and its `Data`.
 *
 * It takes a whole `Folded<unknown>` rather than a value and a certainty so the
 * certainty cannot be reconstructed wrongly at the one place the compiler has
 * stopped watching — `summaryFrom` gates persistence on that discriminant.
 */
export function makeFolded<A>(folded: Folded<unknown>): Folded<A> {
  return folded as unknown as Folded<A>;
}

/** Build a `DataChange` from values the registry erased. Same argument as above. */
export function makeDataChange<Ts extends readonly WidenedNodeType[]>(
  nodeId: NodeId,
  kind: string,
  before: unknown,
  after: unknown,
): DataChange<Ts> {
  const change: Readonly<{
    nodeId: NodeId;
    kind: string;
    before: unknown;
    after: unknown;
  }> = { nodeId, kind, before, after };
  return change as unknown as DataChange<Ts>;
}
