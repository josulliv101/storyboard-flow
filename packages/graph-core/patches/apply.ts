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


/**
 * Copy-on-write removal BY IDENTITY, not by index.
 *
 * Deliberate: a "moved" patch removes several nodes before inserting any, and
 * index-based removal would need every subsequent index rebased. Identity
 * removal is order-independent, so the recorded `fromIndex` is needed only by
 * the inverse — which is precisely what makes swapping endpoints a complete
 * inversion.
 */





// ---------------------------------------------------------------------------
