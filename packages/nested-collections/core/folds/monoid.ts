// Graph — foldMonoid — ergonomics for the easy 90%.
//
// Split out of the former single-file `folds.ts`; see ./index.ts.

import type {
  Certainty,
  CollectionNode,
  ConsumerDefinedFold,
  LeafNode,
  WidenedNodeType,
} from "../types";

import { weakestCertainty } from "./certainty";

// 3. foldMonoid — ergonomics for the easy 90%
// ---------------------------------------------------------------------------

/**
 * Build a `ConsumerDefinedFold` from a monoid plus weakest-wins certainty.
 *
 * USE IT FOR SUMS AND COUNTS. It CANNOT express:
 *
 *  - a subtree VETO (a container's own `disabled` flag dropping its whole
 *    subtree) — by the time `concat` runs, the vetoed subtree is already summed
 *    in and indistinguishable;
 *  - an empty-collection FLOOR — `collection([])` here is `empty`, and `empty`
 *    is also the identity, so the two cannot differ;
 *  - POSITION-SENSITIVE certainty — weakest-wins is position-blind, and the
 *    real first-frame rule is not: an unloaded branch AFTER the first media
 *    leaves the answer correct, so the live result still wins. Weakest-wins
 *    would demote it and send the reader back to the stored summary, discarding
 *    a just-made edit.
 *
 * Those three are why `ConsumerDefinedFold` is the primitive and this is the convenience.
 * Write `ConsumerDefinedFold` by hand when you need any of them.
 */
export function foldMonoid<Ts extends readonly WidenedNodeType[], S, A>(
  m: Readonly<{
    key: string;
    empty: A;
    leaf(node: LeafNode<Ts>): A;
    concat(a: A, b: A): A;
    own?(node: CollectionNode<Ts, S>): A;
    placeholder?(node: CollectionNode<Ts, S>): A | undefined;
  }>,
): ConsumerDefinedFold<Ts, S, A> {
  return {
    key: m.key,
    leaf(node) {
      return m.leaf(node);
    },
    collection(node, children) {
      // NOT `m.own?.(node) ?? m.empty`: an optional call yields `A | undefined`
      // and `??` would then substitute `empty` for an `own` that legitimately
      // returned `undefined` when `A` itself admits it. The explicit check
      // distinguishes "no own step" from "own returned undefined".
      let value = m.own === undefined ? m.empty : m.own(node);
      const certainties: Certainty[] = [];
      for (const child of children) {
        value = m.concat(value, child.value);
        certainties.push(child.certainty);
      }
      return { value, certainty: weakestCertainty(certainties) };
    },
    placeholder(node) {
      // Here `undefined` IS the declared sentinel — "this monoid has no stored
      // stand-in for that node" — so both "no placeholder step" and "step
      // returned undefined" collapse to the same honest answer: nothing is
      // known about the subtree, so `empty` at `"partial"`.
      const supplied = m.placeholder === undefined ? undefined : m.placeholder(node);
      if (supplied === undefined) return { value: m.empty, certainty: "partial" };
      return { value: supplied, certainty: "estimated" };
    },
    missing() {
      // Confirmed-gone is KNOWLEDGE, not a gap: a subtree whose only holes are
      // `missing` folds to "exact". The predecessor treated it as absence and
      // held a 133-document branch at "no duration" indefinitely.
      return { value: m.empty, certainty: "exact" };
    },
    sealed() {
      return { value: m.empty, certainty: "partial" };
    },
  };
}

// ---------------------------------------------------------------------------
