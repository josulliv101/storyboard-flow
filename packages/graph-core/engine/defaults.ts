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
