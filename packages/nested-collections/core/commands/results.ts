// Graph — fail and ok — every rejection this folder builds.
//
// Split out of the former `commands/internals.ts`; see ./index.ts.

import {
  type Rejection,
  type RejectionCode,
  type Result,
} from "../types";

// Internal helpers
// ---------------------------------------------------------------------------

/** Everything on a `Rejection` except the two fields every rejection has. */
type RejectionContext = Omit<Rejection, "code" | "message">;

export function fail<T>(
  code: RejectionCode,
  message: string,
  context?: RejectionContext,
): Result<T, Rejection> {
  // Spreading `undefined` yields `{}`, so the optional argument needs no branch.
  return { ok: false, error: { code, message, ...context } };
}

export function ok<T>(value: T): Result<T, Rejection> {
  return { ok: true, value };
}
