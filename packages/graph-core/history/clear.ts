// Graph — clearing.
//
// Split out of the former single-file `history.ts`; see ./index.ts.

import type {
  History,
  WidenedNodeType,
} from "../types";

// Clearing
// ---------------------------------------------------------------------------

export function clearFuture<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.future.length === 0) return history;
  return { past: history.past, future: [], limit: history.limit };
}

/**
 * The only recovery for a dormant entry whose world moved. Entries replay in
 * order, so one inapplicable entry makes everything beneath it unreachable too —
 * there is no way to skip past a broken entry and keep undoing.
 */
export function clearPast<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.past.length === 0) return history;
  return { past: [], future: history.future, limit: history.limit };
}

export function clearHistory<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.past.length === 0 && history.future.length === 0) return history;
  return { past: [], future: [], limit: history.limit };
}

// ---------------------------------------------------------------------------
