import type { CollectionsGraph, NodeId } from "@storyboard/collections-core";
import type { ClipDetail, DetailsById } from "@storyboard/timeline-domain";
import { normalizeTags } from "@storyboard/timeline-model/tags";

// The DECISION half of editing tags in the browser, split out from the IO so it
// can be tested without a React tree or a gateway.
//
// It exists because tags are the one mutation in the graph view that does not
// go through a graph command. `detailsStore.merge()` emits no CollectionsPatch,
// so PersistenceBridge never fires, so the editor has to work out for itself
// which document to rewrite. Getting that wrong is invisible: the chips update
// and the change is gone on reload.

export type TagWritePlan = Readonly<{
  /** The detail entry to merge, already normalized. */
  detail: ClipDetail;
  /** The document whose clip list must be re-projected and written. */
  parentId: string;
  /** The cleaned tags, for reporting back to the caller. */
  tags: readonly string[];
}>;

export type TagWriteRefusal = Readonly<{
  reason: "unknown-node" | "no-detail" | "is-root";
}>;

/**
 * Work out what a tag change means, or why it cannot be made.
 *
 * Returns the merged detail and the ONE document to rewrite: a clip's stored
 * form lives in its parent's `clips` array, and a tag changes no ancestor's
 * summary (not duration, not itemCount, not previewItems), so nothing above the
 * parent needs touching. This mirrors the server-side rule in
 * `handleSetTags`/`applyCollectionsCommand`, deliberately — the two surfaces
 * must agree about what a tag write affects.
 *
 * Clearing is expressed as REMOVING the key, not storing `[]`. Absence is what
 * "untagged" means everywhere else in this model, and an empty array would make
 * a document grow a field it does not use.
 */
export function planTagWrite(
  graph: CollectionsGraph,
  details: DetailsById,
  nodeId: NodeId,
  tags: readonly string[],
): TagWritePlan | TagWriteRefusal {
  if (!graph.nodesById.has(nodeId)) return { reason: "unknown-node" };

  const existing = details[nodeId as string];
  // No detail entry means nothing to merge INTO — writing a bare `{tags}` here
  // would rebuild the clip without its alt, poster or sourceAsset, which is how
  // provenance gets erased and a file leaks.
  if (!existing) return { reason: "no-detail" };

  // A root has no parent, so it is not a clip in any document and has nowhere
  // for tags to live.
  const parentId = graph.parentById.get(nodeId) ?? null;
  if (parentId === null) return { reason: "is-root" };

  const next = normalizeTags(tags);
  const detail: ClipDetail =
    next.length === 0
      ? (() => {
          const { tags: _dropped, ...rest } = existing;
          return rest;
        })()
      : { ...existing, tags: [...next] };

  return { detail, parentId: parentId as string, tags: next };
}

/** Narrow a plan result. */
export function isTagWriteRefusal(
  result: TagWritePlan | TagWriteRefusal,
): result is TagWriteRefusal {
  return "reason" in result;
}
