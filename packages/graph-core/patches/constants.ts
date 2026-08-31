// Graph — the frozen empties, and the one success value replay hands back.
//
// Split out of the former `patches/internals.ts`; see ./index.ts.

import {
  type NodeId,
  type ReplayRejection,
  type Result,
} from "../types";

/** Shared empty array. Frozen because it is handed out from several readers and
 *  a caller mutating it would corrupt every other reader's view. */
export const EMPTY_IDS: readonly NodeId[] = Object.freeze([]);

export const VERIFY_OK: Result<void, ReplayRejection> = { ok: true, value: undefined };
