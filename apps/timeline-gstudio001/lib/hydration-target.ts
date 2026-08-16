// WHICH DOCUMENT A COLLECTION NODE LOADS FROM, or nothing at all.
//
// A graph node id and a timeline id are the same string for an ordinary
// collection, and the hydration path was written when that was the only case.
// It is not: a DUPLICATE placement is minted as `dup:<parent>:<clip>`
// (adapter.ts), which names a node in the graph and no document anywhere. Sent
// to the gateway it became
//
//   GET /api/timelines/dup%3Atimeline-x%3Atimeline-y  ->  400 Invalid timeline id.
//
// once per duplicate, on every hydration pass — the banner the owner kept
// seeing. The colons fail the route's `^[a-zA-Z0-9_-]+$` check, so the request
// could never have succeeded for any value of the data.
//
// The resolution already existed and this path skipped it: a duplicate's
// detail entry carries `duplicateOfTimelineId`, which `openTimeline` and three
// other call sites already read.

/** The fields this needs from a clip's detail entry. Deliberately structural
 *  rather than importing `ClipDetail`, so the rule stays testable without the
 *  adapter's whole type surface. */
export type HydrationDetail = Readonly<{
  duplicateOfTimelineId?: string;
}>;

/**
 * The server's own rule, mirrored.
 *
 * Duplicated from `app/api/timelines/[id]/route.ts` on purpose: the point is to
 * not SEND a request the server will reject, which means the client has to
 * know the same rule. Kept as one expression so the two can be compared by eye.
 */
const FETCHABLE_TIMELINE_ID = /^[a-zA-Z0-9_-]+$/;

export function isFetchableTimelineId(id: string): boolean {
  return FETCHABLE_TIMELINE_ID.test(id);
}

/**
 * The document id to hydrate a collection node from, or NULL when there is
 * none worth asking for.
 *
 * Null means "do not fetch", and the caller should skip rather than fall back
 * to the node id — falling back is exactly the bug: it produces a request that
 * is guaranteed to 400, and a 400 per duplicate per pass reads as a broken app
 * rather than as an unresolvable reference.
 */
export function hydrationDocumentId(
  detail: HydrationDetail | undefined,
  nodeId: string,
): string | null {
  // A duplicate placement loads from the timeline it REFERENCES. Its own id
  // names a position in this graph, not a document.
  const candidate = detail?.duplicateOfTimelineId ?? nodeId;
  return isFetchableTimelineId(candidate) ? candidate : null;
}
