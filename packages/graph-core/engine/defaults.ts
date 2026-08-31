// Graph — engine defaults: the module-level constants and the pure helpers
// `createEngine` leans on.
//
// Split out of the former single-file `engine.ts`; see ./index.ts. Nothing here
// closes over a config or a store, which is why it can live outside the factory.

import type {
  NodeId,
  ReplayRejection,
} from "../types";

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

/**
 * Computed ONCE per module instance, which is what makes it worth having: the
 * counter above rules out an intra-process collision, and this rules out a
 * cross-process one. Two workers, two tabs, or a server and a client minting
 * ids for the same document each get a different prefix, so their ids cannot
 * meet in the middle when the documents merge.
 *
 * `crypto` is FEATURE-DETECTED rather than assumed. This module must load in a
 * Node route handler, a browser bundle and a bare vitest node environment, and
 * they have historically disagreed about where that global lives — so the
 * fallback is the same `Math.random` this used before, and the detection can
 * only improve on it.
 */
const mintPrefix: string = (() => {
  // Structurally typed, not `Crypto` — this package's `lib` is `esnext` with no
  // DOM, which is the very portability the paragraph above is about. Naming the
  // DOM type here would break the build it is meant to protect.
  const host: Readonly<Record<string, unknown>> =
    globalThis as unknown as Readonly<Record<string, unknown>>;
  const c = host["crypto"];
  if (typeof c === "object" && c !== null) {
    const uuid = (c as Readonly<Record<string, unknown>>)["randomUUID"];
    if (typeof uuid === "function") {
      const value: unknown = (uuid as () => unknown).call(c);
      if (typeof value === "string" && value.length >= 8) return value.slice(0, 8);
    }
  }
  return Math.random().toString(36).slice(2, 10);
})();

export function defaultMintId(): string {
  mintCounter += 1;
  return `graph-${mintPrefix}-${mintCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * How much room over `folds x nodes` a fold cache needs to stop thrashing.
 *
 * The product is the working set's FLOOR. Editing strands `folds x depth`
 * entries per edit, and those strays are newer than a cold live entry, so a
 * table sized exactly to the product evicts something live for every one of
 * them. Measured against the ideal fold-call count per post-edit root read:
 * 1.90x ideal at 1x the product, 1.27x at 2x, 1.00x at 4x. Two is the knee —
 * enough to stop the inversion, not so much that the recommendation reads as
 * absurd for a large board.
 */
export const FOLD_CACHE_HEADROOM = 2;

/**
 * Live-node count past which ONE commit stops fitting an interactive frame.
 *
 * WHY THERE IS A NUMBER HERE AT ALL. A commit copies whole maps: every
 * mutation copies `subtreeRevById` (in `bumpSubtreeRevs`), a data change also
 * copies `nodesById` (in `applyDataChanged`), and an insert or a removal copies
 * four maps rather than two. So commit cost is proportional to how many nodes
 * the document HOLDS and not at all to how small the edit was — one keystroke
 * on one title pays for the whole graph.
 *
 * MEASURED, one `edit-nodes` and one `insert-nodes`, best-of-25, product-shaped
 * fixture (root -> folders of 20 clips):
 *
 *    10,025 nodes   edit  1.21 ms   insert  2.33 ms   0.120 us/node
 *    25,025 nodes   edit  3.26 ms   insert  6.28 ms   0.130 us/node
 *    50,025 nodes   edit  7.59 ms   insert 14.92 ms   0.152 us/node
 *   100,025 nodes   edit 17.06 ms   insert 33.89 ms   0.171 us/node
 *
 * Two things in that table decide this number. The per-node cost RISES with
 * size — 42% worse at 100,000 than at 10,000, as allocation and GC stop being
 * free — so extrapolating the small sizes linearly UNDERSTATES what a large
 * document costs. And `DEFAULT_MAX_NODES` is 100,000, where a single keystroke
 * costs 17 ms: a whole 60Hz frame inside the reducer, before React is asked to
 * render anything. The engine's own default admits documents it cannot serve
 * interactively.
 *
 * 25,000 is where the worst common gesture — an insert, which copies four maps
 * — still costs 6.3 ms, about a third of a frame, leaving the rest for render.
 * Above it the curve bends the wrong way.
 *
 * A DIAGNOSTIC, NOT A GATE, and deliberately not a lowered `maxNodes`. That
 * ceiling is a TRUST boundary: it exists so a hostile payload cannot decide how
 * much memory this process allocates, and lowering it to serve a performance
 * argument would refuse honest documents for the wrong reason. The two numbers
 * answer different questions and both should be sayable — which is the same
 * mistake, in the other direction, that #585 found between `maxNodes` and
 * `foldCacheLimit`. This one is audible instead of enforced.
 */
export const DEFAULT_INTERACTIVE_NODE_BUDGET = 25_000;

/**
 * How many shadow cold refolds one engine will run before switching itself off.
 *
 * A cold fold is O(subtree) — 101ms over 100,000 nodes, measured — so an
 * unbounded shadow turns `devChecks: true` from "slower" into "unusable". A
 * stale entry, if there is one, shows up in the first handful of reads; the
 * thousandth comparison is not where the value is.
 */
export const SHADOW_REFOLD_BUDGET = 1_000;

export const noop = (): void => {};

export function sameIds(a: readonly NodeId[], b: readonly NodeId[]): boolean {
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
export function nothingToReplay(direction: "undo" | "redo"): ReplayRejection {
  const stack = direction === "undo" ? "past" : "future";
  return {
    code: "node-missing",
    message: `Nothing to ${direction}: the ${stack} stack is empty.`,
  };
}
