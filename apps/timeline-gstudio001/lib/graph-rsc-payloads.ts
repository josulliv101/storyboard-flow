import "server-only";

import { collectionChildIds } from "./derive-collection-summaries";
import type { GraphServerPayload } from "./graph-documents-gateway";
import {
  createTimelineEntryReader,
  serveTimelineClosure,
  serveTimelineDocument,
  serveTrashDocument,
} from "./serve-timeline";

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
 * Ceiling on documents ATTEMPTED, as distinct from payloads produced.
 *
 * `MAX_PATH_PAYLOADS` counts successes, so it bounded nothing when serves
 * failed: `activeTimelinePath` is a catch-all route segment, so a URL carrying
 * hundreds of unknown segments produced zero payloads while still costing one
 * storage read per segment. This is the bound that actually holds.
 */
const MAX_PATH_ATTEMPTS = 48;

/**
 * The boot payloads: the project document and the user's trash — the two
 * roots the graph builds from. Null when the project can't be served
 * (missing or denied): the client boots through its legacy fetch path and
 * surfaces the error there.
 */
export type GraphBootstrap = Readonly<{
  payloads: readonly GraphServerPayload[];
  /**
   * Ids the closure walk could not resolve — a `childTimelineId` whose document
   * is gone. Shipped because ONLY the server can tell that apart from a
   * document the client has not loaded yet, and the client needs the difference
   * to know whether it holds a complete closure. Empty on the fallback path
   * below, where the client holds two documents and can prove nothing anyway.
   */
  missing: readonly string[];
}>;

export async function loadGraphBootstrapPayloads(
  projectId: string,
  requesterUid: string,
): Promise<GraphBootstrap | null> {
  try {
    // THE WHOLE CLOSURE, not just the project.
    //
    // This used to serve the project alone — and serving a project reads every
    // document beneath it anyway, to derive collection summaries bottom-up. So
    // all of them were loaded, two of them were shipped, and the client then
    // asked for the rest one card at a time, each of those requests walking its
    // own subtree again. Measured on a 151-document project: 58 requests and
    // ~430 document reads for one page load (#437).
    //
    // Shipping what was already loaded costs nothing extra and leaves the
    // client with a full cache, so the per-card reads never happen.
    //
    // A closure too large to walk returns null, and the caller falls back to
    // the project alone — the old behaviour, which still works, just slower.
    const read = createTimelineEntryReader(requesterUid);
    const closure = await serveTimelineClosure(projectId, requesterUid);
    if (!closure) {
      const project = await serveTimelineDocument(projectId, requesterUid, read);
      if (!project) return null;
      const trash = await serveTrashDocument(`trash-${requesterUid}`, requesterUid, read);
      return {
        payloads: [
          { ...project, forUid: requesterUid },
          { ...trash, forUid: requesterUid },
        ],
        missing: [],
      };
    }
    // The trash is NOT under the project, so it is read separately — through
    // its own reader, since the closure's is finished with.
    const trash = await serveTrashDocument(`trash-${requesterUid}`, requesterUid, read);
    // forUid lets the client's prime refuse payloads that survive an auth
    // transition in the router cache.
    return {
      payloads: [
        ...Object.entries(closure.documents).map(([, served]) => ({
          document: served.document,
          revision: served.revision,
          forUid: requesterUid,
        })),
        { ...trash, forUid: requesterUid },
      ],
      missing: closure.missing,
    };
  } catch {
    return null;
  }
}

/**
 * Payloads for a focus navigation: the path segments' documents, plus one
 * eager child level under the FOCUSED segment. The client hydrates the
 * sub-graph tree lazily (per row, on expand), so this eager level is a pure
 * warm-cache win — a row's first expand hits the primed gateway cache
 * instead of a fresh fetch. Segments that fail to serve are skipped — the
 * client's chain validation and error surfacing remain authoritative.
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
  // Shared across every serve below, so a child read once for its parent's
  // summaries is not read again to become a payload, and its own children are
  // not read a third time.
  const read = createTimelineEntryReader(requesterUid);

  const serve = async (id: string): Promise<GraphServerPayload | null> => {
    if (seen.has(id) || seen.size >= MAX_PATH_ATTEMPTS) return null;
    if (payloads.length >= MAX_PATH_PAYLOADS) return null;
    seen.add(id);
    try {
      const served = await serveTimelineDocument(id, requesterUid, read);
      if (!served) return null;
      return { ...served, forUid: requesterUid };
    } catch {
      return null;
    }
  };

  // The focus chain stays SEQUENTIAL: it is an ancestor path, and each segment
  // is only worth reading if the one above it resolved.
  const segments = options?.focusedOnly ? path.slice(-1) : path;
  let focused: GraphServerPayload | null = null;
  for (const segment of segments) {
    const payload = await serve(segment);
    if (payload) {
      payloads.push(payload);
      focused = payload;
    }
  }

  if (focused) {
    // The eager child level is a FLAT set of independent documents — nothing
    // about one gates another, so serialising them only added latency. Results
    // are pushed in child order regardless of completion order, so the primes
    // the client receives are deterministic.
    const children = collectionChildIds(focused.document).slice(
      0,
      Math.max(0, MAX_PATH_PAYLOADS - payloads.length),
    );
    for (const payload of await Promise.all(children.map((childId) => serve(childId)))) {
      if (payload) payloads.push(payload);
    }
  }

  return payloads;
}
