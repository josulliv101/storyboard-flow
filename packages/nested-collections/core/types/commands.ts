// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { ConsumerDefinedNodeType, WidenedNodeType } from "./node-types";
import type { NodeId } from "./primitives";

// ---------------------------------------------------------------------------
// 4. Commands — the only user-intent mutation vocabulary
// ---------------------------------------------------------------------------

/**
 * A value to insert. The engine mints the id; the consumer supplies content,
 * which is what makes "an insert is undoable" true by construction rather than
 * by convention.
 *
 * `data` is typed as the kind's `D`, and the engine STILL runs `parse` on it
 * and stores parse's OUTPUT — so a normalizing node type normalizes inserts too,
 * and a consumer handing in a value that violates its own invariants is caught
 * at the same door as wire data.
 *
 * `children` is only meaningful for a container kind; supplying it on a leaf
 * kind is rejected (`"leaf-seed-with-children"`). Omitted on a container means
 * a `loaded` empty collection.
 */
export type Seed<Ts extends readonly WidenedNodeType[], S> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer D, infer _E>
    ? Readonly<{
        kind: K;
        data: D;
        children?: readonly Seed<Ts, S>[];
        summary?: S | null;
      }>
    : never;
}[number];

/** One node's content edit, paired with its own kind's edit type. */
export type EditOf<Ts extends readonly WidenedNodeType[]> = {
  [I in keyof Ts]: Ts[I] extends ConsumerDefinedNodeType<infer K, infer _D, infer E>
    ? Readonly<{ nodeId: NodeId; kind: K; edit: E }>
    : never;
}[number];

/**
 * ONE gesture = ONE command = ONE patch = ONE history entry. A rename across
 * every placement of an asset is a single `edit-nodes` over all of them, which
 * is what keeps Ctrl-Z matching what the user thinks they did.
 */
export type Command<Ts extends readonly WidenedNodeType[], S> =
  | Readonly<{
      type: "move-nodes";
      nodeIds: readonly NodeId[];
      toParentId: NodeId;
      /**
       * POST-REMOVAL index — the index in the target's children array AFTER
       * the moved nodes have been taken out of it. Computing this is the most
       * re-derived, most often wrong arithmetic in a DnD engine (the
       * predecessor silently appended on cut+paste for exactly this reason),
       * so `resolveDrop` is the ONLY place it is computed and everything else
       * consumes the answer.
       */
      toIndex: number;
    }>
  | Readonly<{
      type: "insert-nodes";
      seeds: readonly Seed<Ts, S>[];
      toParentId: NodeId;
      toIndex: number;
    }>
  | Readonly<{
      type: "remove-nodes";
      nodeIds: readonly NodeId[];
      /**
       * Required to remove a container whose children are not loaded. The
       * patch then records only the placeholder plus its summary, and the
       * change feed reports it so the consumer can defer the hard delete.
       */
      allowUnloaded?: boolean;
    }>
  | Readonly<{ type: "edit-nodes"; edits: readonly EditOf<Ts>[] }>;

/**
 * What a pointer gesture produced, in PRE-removal coordinates — the numbers a
 * view can actually measure. `resolveDrop` turns this into a `Command` and is
 * the one place the post-removal conversion happens.
 *
 * No anchors (`{ after: X }`) in v1: anchors are the right answer for rebasing
 * concurrent edits, which v1 does not do, so adding them now doubles the
 * intent surface and buys nothing.
 */
export type DropIntent<Ts extends readonly WidenedNodeType[], S> =
  | Readonly<{
      type: "move";
      nodeIds: readonly NodeId[];
      toParentId: NodeId;
      /** Index in the target's children array AS THE VIEW SEES IT NOW. */
      toIndexBefore: number;
    }>
  | Readonly<{
      type: "insert";
      seeds: readonly Seed<Ts, S>[];
      toParentId: NodeId;
      toIndexBefore: number;
    }>;
