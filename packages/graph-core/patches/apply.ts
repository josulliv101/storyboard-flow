// Graph — applyPatch — THE ONLY index rewriter.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  type EngineContext,
  type Graph,
  type WidenedNodeType,
  type Patch,
} from "../types";

import { applyDataChanged, applyInserted, applyMoved, applyRemoved } from "./arms";

// applyPatch — THE ONLY index rewriter
// ---------------------------------------------------------------------------

/**
 * PRECONDITION: `verifyPatchApplies` returned ok. This function assumes the
 * patch applies and does not re-check — re-checking here would either duplicate
 * verify (and drift from it) or tempt a caller to skip verify because "apply
 * validates anyway", which is exactly how the dormant-patch corruptions
 * happened.
 */
export function applyPatch<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  switch (patch.type) {
    case "moved":
      return applyMoved(graph, patch.moves, ctx);
    case "inserted":
      return applyInserted(graph, patch.placements, ctx);
    case "removed":
      return applyRemoved(graph, patch.placements, ctx);
    case "data-changed":
      return applyDataChanged(graph, patch.changes, ctx);
  }
}


// The block that stood here documented a copy-on-write removal helper that left
// with the folder split, and described it as though it were still below. Its
// two claims both live with the code now: "removal by identity is
// order-independent" is argued at `spliceOutMany` in ./splicing, where the
// single pass depends on it, and "the recorded `fromIndex` is needed only by the
// inverse" is argued at `invertPatch`, which is what swaps the endpoints. A
// third copy attached to nothing is how a reader ends up looking for a function
// that is not here.


// ---------------------------------------------------------------------------
