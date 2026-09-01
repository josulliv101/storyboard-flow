// Graph — the questions a patch asks about a node before touching it.
//
// Split out of the former `patches/internals.ts`; see ./index.ts.

import {
  type GraphNode,
  type ChildrenState,
  type WidenedNodeType,
} from "../types";

/**
 * The node's `ChildrenState`, or `null` when it has none (a leaf, or a
 * sealed leaf).
 *
 * Discriminates on `sealed` FIRST and `container` second, which is the
 * only order that works: `container` is plain `boolean` on the sealed arm
 * (it comes off the wire), so it is not disjoint from the `true` / `false`
 * literals on the other two and cannot discriminate on its own.
 */
export function containerChildrenState<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
): ChildrenState | null {
  if (node.sealed) return node.children;
  if (node.container) return node.children;
  return null;
}

/** `true` when this node owns a `childrenById` entry â€” i.e. it is a `loaded`
 *  container. Exactly one state has an entry; the other three have none. */
export function isLoadedContainer<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
): boolean {
  const state = containerChildrenState(node);
  return state !== null && state.status === "loaded";
}

/**
 * Structural equality over a SERIALIZED value.
 *
 * Explicit stack, never recursion: `data` is consumer-shaped and arrives from
 * the wire, so its nesting depth is hostile input. This is the same rule the
 * graph walks follow, applied to content.
 *
 * Object.is (not ===) so a node type that legitimately stores NaN compares equal to
 * itself; otherwise a `data-changed` undo of a NaN-bearing node would be
 * refused forever with "data-mismatch".
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  const stack: Readonly<{ left: unknown; right: unknown }>[] = [
    { left: a, right: b },
  ];
  /**
   * Object pairs this walk has already taken on, so a cyclic value terminates.
   *
   * WITHOUT THIS THE PROCESS DIES, and not slowly. Two DISTINCT values that
   * each hold a back-reference â€” `out.self = out` from either side of the
   * comparison below â€” make the walk push two frames for every one it pops, so
   * the stack grows without bound. Measured: heap exhaustion at 4 GB and a
   * killed process in 23 seconds. `Object.is` is no help, because the two
   * `serialize` calls return two different objects.
   *
   * A PARSED value may legitimately hold a back-pointer, and this compares
   * `serialize` OUTPUT rather than parsed data â€” so reaching it takes a node
   * type whose `serialize` returns a cycle, which is a consumer bug on the same
   * footing as the throwing `serialize` the caller already wraps. Wire data
   * cannot carry one; an in-memory `raw` handed to `deserialize` can.
   *
   * NOT A STEP BUDGET, and that distinction is the whole design. ./types argues
   * that `verifyPatchApplies` needs a comparator that CANNOT abstain, because a
   * budget bail surfaces as a spurious `data-mismatch` â€” a legitimate undo
   * refused for being large. That argument is right, and a budget would have
   * broken exactly the case it was meant to protect: a clip with a few hundred
   * keyframes is big, not cyclic. A memo changes no verdict on any acyclic
   * value; it only makes the cyclic ones finish.
   *
   * CO-INDUCTIVE, which is the standard rule and the only one that stays
   * definite: a pair already under comparison is ASSUMED equal. The assumption
   * costs nothing, because any concrete disagreement anywhere in the walk
   * returns `false` immediately, and `true` is only reached once every pair has
   * been discharged. `a.self = a` against `b.self = b` compares equal â€” which is
   * correct, they are structurally identical â€” while `a.self = a` against
   * `b.self = {}` still returns `false` on the key-count check.
   *
   * Allocated lazily and only for object-vs-object pairs, so a comparison that
   * never reaches two objects never builds one. The residual bound is the
   * number of DISTINCT pairs the walk reaches, which for the wire-shaped values
   * this shares with the rest of the package is the size of the value.
   */
  let seen: Map<object, Set<object>> | null = null;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { left, right } = frame;
    if (Object.is(left, right)) continue;

    // Both sides are objects, so this pair can recur. Record it before
    // descending, which is what makes a cycle terminate rather than repeat.
    if (
      typeof left === "object" &&
      left !== null &&
      typeof right === "object" &&
      right !== null
    ) {
      if (seen === null) seen = new Map<object, Set<object>>();
      let against = seen.get(left);
      if (against === undefined) {
        against = new Set<object>();
        seen.set(left, against);
      }
      // Already taken on higher in the walk: assume equal and stop descending.
      if (against.has(right)) continue;
      against.add(right);
    }

    const leftIsArray = Array.isArray(left);
    if (leftIsArray || Array.isArray(right)) {
      if (!leftIsArray || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        stack.push({ left: left[i], right: right[i] });
      }
      continue;
    }

    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      // An own-key check, not just `right[key] !== undefined`: `{a: undefined}`
      // and `{}` have different serialized shapes and a node type is entitled to
      // care about the difference.
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      stack.push({ left: left[key], right: right[key] });
    }
  }
  return true;
}

/** A type predicate rather than a cast â€” the core's only sanctioned casts live
 *  in the four boundary constructors in ./types, and this needs none. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------

// --- list splicing, shared by ./apply and every arm in ./arms ---------------
