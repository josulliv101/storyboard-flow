// Graph — replayError — the one place a replay rejection is built.
//
// Split out of the former `patches/internals.ts`; see ./index.ts.

import {
  type ReplayRejection,
  type ReplayRejectionCode,
  type Result,
} from "../types";

export function replayError(
  code: ReplayRejectionCode,
  message: string,
  // Derived from `ReplayRejection` rather than re-spelled: this used to list
  // the three fields by hand, so adding `limit`/`actual` to the rejection made
  // the type that CONSTRUCTS it reject them. One shape, one place.
  detail?: Omit<ReplayRejection, "code" | "message">,
): Result<void, ReplayRejection> {
  return { ok: false, error: { code, message, ...detail } };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------
