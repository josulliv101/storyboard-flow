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

import { isDuplicateNodeId } from "@storyboard/timeline-domain";

/** The fields this needs from a clip's detail entry. Deliberately structural
 *  rather than importing `ClipDetail`, so the rule stays testable without the
 *  adapter's whole type surface. */
export type HydrationDetail = Readonly<{
  duplicateOfTimelineId?: string;
}>;

/**
 * The document id to hydrate a collection node from, or NULL when there is
 * none worth asking for.
 *
 * Null means "do not fetch", and the caller should skip rather than fall back
 * to the node id — falling back is exactly the bug: it produces a request that
 * is guaranteed to 400, and a 400 per duplicate per pass reads as a broken app
 * rather than as an unresolvable reference.
 *
 * THE TEST IS THE SYNTHETIC PREFIX, NOT THE CHARACTER SET. This first shipped
 * mirroring the route's `^[a-zA-Z0-9_-]+$` — "do not send a request the server
 * will reject" — which is a true statement about the SERVER and the wrong
 * question to ask here. Node ids may contain any non-whitespace character, so
 * that rule also refused `scene/a` and `timeline-e2e,comma`: ordinary
 * collections, with ordinary documents, which then reported themselves as a
 * missing reference and never loaded. Two e2e tests exist for exactly that
 * class of id and both caught it.
 *
 * A node that names no document is a DUPLICATE placement, and the only
 * reliable way to recognise one is the prefix the adapter minted it with.
 */
export function hydrationDocumentId(
  detail: HydrationDetail | undefined,
  nodeId: string,
): string | null {
  // A duplicate placement loads from the timeline it REFERENCES. Its own id
  // names a position in this graph, not a document.
  const referenced = detail?.duplicateOfTimelineId;
  if (referenced !== undefined) {
    // A recorded reference that is itself synthetic names no document either,
    // so there is still nothing to ask for.
    return isDuplicateNodeId(referenced) ? null : referenced;
  }
  // No reference recorded. A synthetic id has no document to fall back to —
  // that fallback is the `GET /api/timelines/dup%3A…` this file exists to
  // stop. Anything else is an ordinary collection and loads from its own id,
  // whatever characters that id happens to contain.
  return isDuplicateNodeId(nodeId) ? null : nodeId;
}
