// Pure ownership rules for timeline documents — no Firebase imports, so the
// authorization decision itself is unit-testable in isolation. Enforcement
// lives in lib/firebase-timeline-store.ts (every store function requires the
// requester's uid); routes additionally pre-check user-scoped ids.

/**
 * The one access rule:
 *
 * - `owned`  — the record belongs to the requester.
 * - `denied` — anything else: another user's record, OR a record with no
 *   owner at all.
 *
 * An UNOWNED record is denied, not granted. There used to be a third answer,
 * `claim`, which handed an ownerless record to the first authenticated user
 * who touched it — a self-executing migration for documents predating
 * ownership stamping. It worked, but its exposure window only closed once no
 * ownerless records remained, and nothing measured that: listing projects
 * batch-stamped every ownerless project it saw, and knowing a bare id was
 * enough to take or delete the document behind it.
 *
 * The migration is done — `npm run audit:ownership` reported 0 ownerless
 * records across all 144 documents after
 * `scripts/stamp-ownerless-timelines.mjs` ran — so the window is shut for
 * good. Re-run that audit before assuming a new ownerless record cannot
 * appear; the answer here is now deliberately unforgiving, and a record that
 * somehow loses its owner becomes unreachable rather than up for grabs.
 */
export type OwnershipDecision = "owned" | "denied";

export function resolveOwnership(
  recordOwnerUid: string | null | undefined,
  requesterUid: string,
): OwnershipDecision {
  if (recordOwnerUid === null || recordOwnerUid === undefined || recordOwnerUid === "") {
    return "denied";
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
