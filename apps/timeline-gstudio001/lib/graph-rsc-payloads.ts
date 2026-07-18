import "server-only";

import { collectionChildIds } from "./derive-collection-summaries";
import type { GraphServerPayload } from "./graph-documents-gateway";
import { serveTimelineDocument, serveTrashDocument } from "./serve-timeline";

// RSC read-path loaders (fold-in of the codex/rsc-graph-poc direction):
// server components deliver served documents + revisions as PROPS, and the
// client primes the documents gateway with them — no client fetch for what
// the server already read, and the write path's compare-and-set ledger is
// seeded from the same read. Everything here is BEST-EFFORT: any failure
// (no session, denied, missing) simply yields fewer payloads, and the
// client's existing fetch-on-demand paths cover the gap.

export type { GraphServerPayload };

// One graph change spans a handful of documents; a focus path plus one
// eager child level stays small. The cap guards pathological data.
const MAX_PATH_PAYLOADS = 16;

/**
 * The boot payloads: the project document and the user's trash — the two
 * roots the graph builds from. Null when the project can't be served
 * (missing or denied): the client boots through its legacy fetch path and
 * surfaces the error there.
 */
export async function loadGraphBootstrapPayloads(
  projectId: string,
  requesterUid: string,
): Promise<readonly GraphServerPayload[] | null> {
  try {
    const project = await serveTimelineDocument(projectId, requesterUid);
    if (!project) return null;
    const trash = await serveTrashDocument(`trash-${requesterUid}`, requesterUid);
    return [project, trash];
  } catch {
    return null;
  }
}

/**
 * Payloads for a focus navigation: the path segments' documents, plus one
 * eager child level under the FOCUSED segment (mirroring the client's
 * eager hydration, so drill-in needs no fetches when these win the race).
 * Segments that fail to serve are skipped — the client's chain validation
 * and error surfacing remain authoritative.
 *
 * `focusedOnly` is the soft-navigation DELTA: a client that navigated here
 * already holds the ancestors (boot + earlier navigations served them), so
 * only the newly focused tail is worth reading again. Document loads (deep
 * links) get the full path.
 */
export async function loadFocusPathPayloads(
  path: readonly string[],
  requesterUid: string,
  options?: Readonly<{ focusedOnly?: boolean }>,
): Promise<readonly GraphServerPayload[]> {
  const payloads: GraphServerPayload[] = [];
  const seen = new Set<string>();

  const serve = async (id: string) => {
    if (seen.has(id) || payloads.length >= MAX_PATH_PAYLOADS) return null;
    seen.add(id);
    try {
      const served = await serveTimelineDocument(id, requesterUid);
      if (served) payloads.push(served);
      return served;
    } catch {
      return null;
    }
  };

  const segments = options?.focusedOnly ? path.slice(-1) : path;
  let focused: GraphServerPayload | null = null;
  for (const segment of segments) {
    focused = (await serve(segment)) ?? focused;
  }
  if (focused) {
    for (const childId of collectionChildIds(focused.document)) {
      await serve(childId);
    }
  }

  return payloads;
}
