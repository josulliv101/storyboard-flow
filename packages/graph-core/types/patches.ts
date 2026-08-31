// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { GraphNode } from "./graph";
import type { ConsumerDefinedNodeType, WidenedNodeType } from "./node-types";
import type { NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 5. Patches — the reversible record of a mutation
// ---------------------------------------------------------------------------

/**
 * One node's relocation. Both endpoints in their own state's coordinates, so
 * inverting is swapping them.
 *
 * `fromParentId` is not redundant with the graph: a move has TWO ancestor
 * chains to bump, and the source chain exists only in the PRE-state
 * `parentById`. Reading it off the patch is what lets `applyPatch` bump both
 * without holding the old graph.
 */
export type Move = Readonly<{
  nodeId: NodeId;
  fromParentId: NodeId;
  fromIndex: number;
  toParentId: NodeId;
  toIndex: number;
}>;

/**
 * One node at one position. The SAME payload serves insertion and removal,
 * which is what makes add/remove trivially invertible.
 *
 * `node` is the FULL node, so a removed subtree is restorable exactly —
 * including a quarantined node's byte-exact `raw`.
 */
export type Placement<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  node: GraphNode<Ts, S>;
  parentId: NodeId;
  index: number;
}>;

/** One node's DATA change, structure untouched. Whole values, so inverting is a swap. */
export type DataChange<Ts extends readonly WidenedNodeType[]> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer D, infer _E>
    ? Readonly<{ nodeId: NodeId; kind: K; before: D; after: D }>
    : never;
}[number];

/**
 * A patch carries NO rollups and NO derived values. A rollup in a patch is a
 * lie the moment anything moves.
 *
 * ORDER IS PART OF THE CONTRACT, because `invertPatch` preserves array order
 * and only flips the tag:
 *   - `inserted` — DOCUMENT ORDER, parents before children. `applyPatch` walks
 *     it FORWARD, inserting each at its `index`.
 *   - `removed` — the exact mirror: same array, same order, same indices.
 *     `applyPatch` walks it BACKWARD, so children leave before parents and a
 *     later sibling's splice cannot invalidate an earlier one's index.
 */
export type Patch<Ts extends readonly WidenedNodeType[], S> =
  | Readonly<{ type: "moved"; moves: readonly Move[] }>
  | Readonly<{ type: "inserted"; placements: readonly Placement<Ts, S>[] }>
  | Readonly<{ type: "removed"; placements: readonly Placement<Ts, S>[] }>
  | Readonly<{ type: "data-changed"; changes: readonly DataChange<Ts>[] }>;
