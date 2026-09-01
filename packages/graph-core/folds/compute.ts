// Graph — computeFold — the traversal.
//
// Split out of the former single-file `folds.ts`; see ./index.ts.

import { getChildren, getNode, getSubtreeRev } from "../graph";
import { describeThrown } from "../types";
import type {
  GraphNode,
  ConsumerDefinedFold,
  FoldCache,
  Folded,
  FoldedChild,
  Graph,
  NodeId,
  WidenedNodeType,
} from "../types";

// 5. computeFold
// ---------------------------------------------------------------------------

type Frame = Readonly<{ id: NodeId; expanded: boolean }>;

/** Which of the five hooks a fold answered a node with. */
type FoldHook = "sealed" | "leaf" | "missing" | "placeholder" | "collection";

/**
 * A consumer fold hook threw.
 *
 * PRIVATE BY CONSTRUCTION, exactly like `KeyHookFailure` in ./graph and for the
 * same reason: it is not exported from ./index, so a consumer cannot construct
 * one, and the catch below cannot be spoofed into reporting an engine bug as a
 * fold's fault. It is narrower than that one — `KeyHookFailure` has to travel
 * out to six Result-typed doors, while nothing catches this outside
 * `computeFold`, so it never leaves this file.
 */
class FoldHookFailure extends Error {
  readonly foldKey: string;
  readonly hook: FoldHook;
  readonly nodeId: NodeId;
  readonly cause: unknown;

  constructor(foldKey: string, hook: FoldHook, nodeId: NodeId, cause: unknown) {
    super(
      `graph-core: fold ${JSON.stringify(foldKey)}.${hook} threw for node ` +
        `${JSON.stringify(nodeId)}. ${describeThrown(cause)}`,
    );
    this.name = "FoldHookFailure";
    this.foldKey = foldKey;
    this.hook = hook;
    this.nodeId = nodeId;
    this.cause = cause;
  }
}

/**
 * THE ONLY cast in this module, and the erasure it crosses is intrinsic to
 * `FoldCache`: one cache serves every registered fold, those folds have
 * different `A`s, so the slot type has to be `unknown`.
 *
 * The soundness argument is the same as the boundary constructors in ./types —
 * this value was written by THIS function, under THIS `fold.key`, so it is a
 * `Folded<A>`. `fold.key` is what makes the argument hold, which is why the key
 * is part of the cache key and not a decorative label. Two folds registered
 * with the SAME `key` and different `A` would break it; `createEngine` refuses
 * that at construction, which is what lets this cast stand. That check was
 * missing when this comment first claimed it — the argument was sound and the
 * premise was not.
 *
 * `undefined` unambiguously means "miss" because `Folded<A>` is always an
 * object, never `undefined`, for every `A`.
 */
function readCachedFold<A>(
  cache: FoldCache,
  foldKey: string,
  nodeId: NodeId,
  subtreeRev: number,
): Folded<A> | undefined {
  const hit = cache.get(foldKey, nodeId, subtreeRev);
  if (!hit.hit) return undefined;
  return hit.value as Folded<A>;
}

/**
 * Run ONE consumer fold hook, so that its throw arrives at the bottom of
 * `computeFold` as this module's tag rather than as the caller's problem.
 *
 * `instanceof` a private class, never a bare `catch` around the walk. A bare
 * catch would report a bug inside this engine as the consumer's fault and hide
 * it behind an `undefined` nobody can act on — the same argument ./graph makes
 * for `KeyHookFailure`, and the reason the tag is thrown HERE, beside the call,
 * rather than inferred from a "which hook was running" variable at the catch.
 *
 * ONE CLOSURE PER NODE, not per hook — exactly one of the five runs for any
 * given node, so this adds one allocation to a walk that already allocates a
 * `Frame` and a `results` entry per node.
 *
 * NO WALL-CLOCK NUMBER IS CLAIMED HERE, deliberately. A cold fold over 100,000
 * nodes measured 27.7-30.2 ms without this and 30.1-37.5 ms with it, on an
 * interleaved best-of-7 — the two ranges overlap, so the honest reading is
 * "within noise", not a percentage. This package has written three wall-clock
 * bounds that CI then disproved; the reproducible fact is the one
 * `tests/performance.test.ts` asserts, which is a COUNT, and this change leaves
 * every one of those counts identical because it adds no hook calls, no node
 * visits and no cache operations.
 */
function hooked<A>(
  fold: Readonly<{ key: string }>,
  hook: FoldHook,
  nodeId: NodeId,
  run: () => A,
): A {
  try {
    return run();
  } catch (thrown) {
    throw new FoldHookFailure(fold.key, hook, nodeId, thrown);
  }
}

/**
 * Did this child's value come out of `fold.placeholder` — i.e. is it a stand-in
 * for a subtree nobody has read?
 *
 * TRUE for `unloaded` and `reference` ONLY. A sealed node is deliberately
 * NOT a placeholder even when its own children state says `unloaded`: it was
 * answered by `fold.sealed`, whose returned certainty is the fold author's
 * own signal about forward-incompatible data. Folding the two together would
 * make `placeholder` mean two different things at once and leave neither
 * recoverable from the flag.
 */
function isPlaceholderNode<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
): boolean {
  // Discriminate on `sealed` FIRST: `container` is plain `boolean` on the
  // sealed arm (it comes off the wire), so it cannot separate the three.
  if (node.sealed) return false;
  if (!node.container) return false;
  const status = node.children.status;
  return status === "unloaded" || status === "reference";
}

/**
 * Evaluate `fold` at `nodeId`, bottom-up, with an EXPLICIT STACK — never
 * recursion. Depth is hostile input: a document can nest as deeply as whoever
 * wrote it liked, and a `RangeError` thrown out of a React render is not
 * recoverable.
 *
 * Dispatch, in order:
 *   sealed         -> fold.sealed(node)     (children NOT visited)
 *   leaf                -> { fold.leaf(node), "exact" }
 *   collection missing  -> fold.missing(node)
 *   collection unloaded
 *     | reference       -> fold.placeholder(node)
 *   collection loaded   -> fold.collection(node, children)
 *
 * A sealed CONTAINER's children stay addressable and movable in the graph,
 * but they are not folded: sealing is answered once, by the one hook that
 * exists for it, and a fold that walked into data the engine could not parse
 * would be reporting on values nobody validated.
 *
 * Returns `undefined` when `nodeId` is unknown. That is routine, not
 * exceptional — in React a card outlives its node by a frame on every removal.
 * It is ALSO what a fold that threw answers with, for the reason below.
 *
 * TOTAL. A fold's five hooks are consumer code, and they were the last family
 * in this package called with no guard at all: listeners go through
 * `notifyOne`, `contentKey`/`sourceKey` through `KeyHookFailure`, and `parse`,
 * `serialize` and `applyEdit` are each wrapped at their own door. Measured
 * before this: a `fold.collection` that threw came straight out of
 * `store.aggregate`, which React calls once per mounted card during render.
 *
 * `undefined`, NOT a rejection, because there is no other answer available.
 * `Folded<A>`'s `A` is the consumer's own type and this module cannot
 * manufacture a value of it, so there is nothing to return but "no answer" —
 * which is a case every caller already handles, since a card outliving its node
 * produces it on every removal.
 *
 * THE WHOLE WALK IS ABANDONED, not just the failing node. Dropping one node and
 * folding on would hand the parent a subtree with a hole in it and report the
 * result as `exact` — a wrong number that looks right, which is the exact
 * failure the shadow cold refold exists to catch. Descendants already committed
 * stay in the cache and stay correct: each was computed by a hook that returned,
 * and each is keyed by its own `(fold.key, id, rev)`.
 *
 * REPORTED, never silent, for `notifyOne`'s reason — `undefined` otherwise
 * means both "the node is gone" and "your fold crashed", and those need
 * different fixes. One line per `aggregate` call rather than per node, because
 * the first throw ends the walk.
 *
 * Pass `cache` to memoize; results are keyed by `(fold.key, id, subtreeRev)`,
 * so passing a cache can never change the answer, only the work.
 */
export function computeFold<Ts extends readonly WidenedNodeType[], S, A>(
  graph: Graph<Ts, S>,
  fold: ConsumerDefinedFold<Ts, S, A>,
  nodeId: NodeId,
  cache?: FoldCache,
): Folded<A> | undefined {
  if (getNode(graph, nodeId) === undefined) return undefined;

  const results = new Map<NodeId, Folded<A>>();
  /**
   * Loaded collections that have already had their `expanded` frame pushed.
   *
   * This is NOT the predecessor's `visiting` guard — that one existed because
   * following a duplicate's pointer could revisit a node already on the stack,
   * and it is gone for good: references are leaves, so the placement forest is
   * a genuine tree and a correct graph never needs this.
   *
   * It is here because a cycle is an INVARIANT VIOLATION (the reducer refuses
   * to create one, `deserialize` refuses to load one, `findInvariantViolation`
   * reports one) and this is a read path. On a hand-corrupted graph the choice
   * is between an unbounded loop inside a render and a dropped child; a dropped
   * child is recoverable and a hung tab is not.
   */
  const opened = new Set<NodeId>();
  const stack: Frame[] = [{ id: nodeId, expanded: false }];

  const commit = (id: NodeId, value: Folded<A>): void => {
    results.set(id, value);
    if (cache !== undefined) {
      cache.set(fold.key, id, getSubtreeRev(graph, id), value);
    }
  };

  try {
    return walk<Ts, S, A>(graph, fold, nodeId, cache, results, opened, stack, commit);
  } catch (thrown) {
    // THE TAG ONLY. Anything else is a bug in this engine and must keep
    // crashing as itself rather than being reported as a fold's fault.
    if (!(thrown instanceof FoldHookFailure)) throw thrown;
    console.error(
      `${thrown.message} The aggregate for ${JSON.stringify(nodeId)} is ` +
        `unavailable; nothing else is affected and the graph is untouched.`,
    );
    return undefined;
  }
}

/** The walk itself. Split out only so the guard above reads as a guard. */
function walk<Ts extends readonly WidenedNodeType[], S, A>(
  graph: Graph<Ts, S>,
  fold: ConsumerDefinedFold<Ts, S, A>,
  nodeId: NodeId,
  cache: FoldCache | undefined,
  results: Map<NodeId, Folded<A>>,
  opened: Set<NodeId>,
  stack: Frame[],
  commit: (id: NodeId, value: Folded<A>) => void,
): Folded<A> | undefined {
  while (stack.length > 0) {
    const frame = stack.pop();
    // `pop` is typed `Frame | undefined` regardless of the length guard, and
    // this repo does not paper over that with `!`.
    if (frame === undefined) break;
    if (results.has(frame.id)) continue;

    const node = getNode(graph, frame.id);
    // A child id that resolves to nothing is a `dangling-child` violation.
    // `findInvariantViolation` is where that gets reported; here it is simply
    // dropped, because the fold has no hook for "a node that is not there" and
    // inventing a value would be worse than omitting one.
    if (node === undefined) continue;

    if (!frame.expanded && cache !== undefined) {
      const cached = readCachedFold<A>(
        cache,
        fold.key,
        frame.id,
        getSubtreeRev(graph, frame.id),
      );
      if (cached !== undefined) {
        // A hit skips the entire subtree — that is the point of a bottom-up
        // walk over a rev-keyed cache.
        results.set(frame.id, cached);
        continue;
      }
    }

    if (node.sealed) {
      commit(node.id, hooked(fold, "sealed", node.id, () => fold.sealed(node)));
      continue;
    }

    if (!node.container) {
      // A leaf is always exact; only placeholders, sealing and a fold's own
      // judgement introduce uncertainty, so the evaluator wraps without asking.
      commit(node.id, {
        value: hooked(fold, "leaf", node.id, () => fold.leaf(node)),
        certainty: "exact",
      });
      continue;
    }

    const state = node.children;
    if (state.status === "missing") {
      commit(node.id, hooked(fold, "missing", node.id, () => fold.missing(node)));
      continue;
    }
    if (state.status === "unloaded" || state.status === "reference") {
      commit(
        node.id,
        hooked(fold, "placeholder", node.id, () => fold.placeholder(node)),
      );
      continue;
    }

    const childIds = getChildren(graph, node.id);

    if (!frame.expanded) {
      if (opened.has(node.id)) continue;
      opened.add(node.id);
      // Parent first so it pops LAST, after every child has landed in
      // `results`. Children pushed in reverse so they pop in document order —
      // the order does not change the answer (each child is folded
      // independently) but it keeps a fold's own side effects, and a debugger's
      // step order, matching the list the user sees.
      stack.push({ id: node.id, expanded: true });
      for (let i = childIds.length - 1; i >= 0; i -= 1) {
        const childId = childIds[i];
        if (childId === undefined) continue;
        stack.push({ id: childId, expanded: false });
      }
      continue;
    }

    const children: FoldedChild<A>[] = [];
    for (const childId of childIds) {
      const childFolded = results.get(childId);
      if (childFolded === undefined) continue;
      const childNode = getNode(graph, childId);
      if (childNode === undefined) continue;
      children.push({
        ...childFolded,
        id: childId,
        placeholder: isPlaceholderNode(childNode),
      });
    }
    commit(
      node.id,
      hooked(fold, "collection", node.id, () => fold.collection(node, children)),
    );
  }

  return results.get(nodeId);
}
