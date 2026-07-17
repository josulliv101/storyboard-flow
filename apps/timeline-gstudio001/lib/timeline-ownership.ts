// Pure ownership rules for timeline documents — no Firebase imports, so the
// authorization decision itself is unit-testable in isolation. Enforcement
// lives in lib/firebase-timeline-store.ts (every store function requires the
// requester's uid); routes additionally pre-check user-scoped ids.

/**
 * The one access rule:
 *
 * - `owned`  — the record belongs to the requester.
 * - `claim`  — the record predates ownership stamping (no ownerUid). It is
 *   CLAIMED by the first authenticated user who touches it — a self-executing
 *   migration for legacy documents, chosen deliberately over treating them as
 *   public or breaking the existing user's access until a manual script runs.
 *   The exposure window is deploy-until-the-owner's-next-visit; after that
 *   every document is stamped and strictly enforced.
 * - `denied` — the record belongs to someone else.
 */
export type OwnershipDecision = "owned" | "claim" | "denied";

export function resolveOwnership(
  recordOwnerUid: string | null | undefined,
  requesterUid: string,
): OwnershipDecision {
  if (recordOwnerUid === null || recordOwnerUid === undefined || recordOwnerUid === "") {
    return "claim";
  }
  return recordOwnerUid === requesterUid ? "owned" : "denied";
}

/**
 * Some timeline ids embed their owner's uid by construction (`trash-<uid>`,
 * `asset-library-<uid>`, `asset-library-col-<uid>-<folder>`). For those the
 * check needs no storage read at all.
 *
 * Returns `null` when the id is not user-scoped (ownership must come from
 * the stored record), otherwise whether the embedded uid is the requester's.
 */
export function checkUserScopedId(id: string, requesterUid: string): boolean | null {
  if (id.startsWith("trash-")) {
    return id === `trash-${requesterUid}`;
  }
  if (id.startsWith("asset-library-col-")) {
    return id.startsWith(`asset-library-col-${requesterUid}-`);
  }
  if (id.startsWith("asset-library-")) {
    return id === `asset-library-${requesterUid}`;
  }
  return null;
}

/** Thrown by the store when a document belongs to a different user. Routes
 *  map it to 404 — a plain not-found, so ids can't be probed for existence. */
export class TimelineAccessDeniedError extends Error {
  constructor(id: string) {
    super(`Access to timeline "${id}" was denied.`);
    this.name = "TimelineAccessDeniedError";
  }
}
