import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";
import { parseNodeId, type CollectionItemNode } from "@storyboard/ui/dnd-collections";
import type { ClipDetail } from "@storyboard/timeline-domain";

// The pure clone engine behind Duplicate / Copy-Paste.
//
// A media clip clones from the live graph node alone: a fresh id and a copy of
// its props (src, trims, poster). A collection is an INDEPENDENT deep clone —
// it maps to a timeline DOCUMENT, so cloning it means walking the document
// tree (`readDocument`), remapping every timeline id and clip id, and emitting
// one new document per cloned collection. The top-level clone re-enters the
// graph as an empty placeholder node whose id IS the fresh root timeline id;
// its seeded document supplies the children on drill-in. See the id
// conventions in `@storyboard/timeline-domain` adapter (`buildHydrationSpecs` /
// `graphChildrenToClips`): a collection node's id doubles as its clip id and
// its `childTimelineId`, and a media node's id is its clip id.
//
// Pure and deterministic given `readDocument` + `mintId`, so it unit-tests
// without the gateway; the async fill of an un-hydrated subtree (`ensure`)
// happens in the caller BEFORE this runs, so `readDocument` is a cache read.

export type CloneForInsert = Readonly<{
  /** The fresh node to `add-nodes` into the target collection. */
  node: CollectionItemNode;
  /** Detail to park for the new node before the add commits (undefined when
   *  the source had none). */
  detail: ClipDetail | undefined;
  /** New timeline documents to `seed()` + `writeClips` — one per cloned
   *  collection, deepest first. Empty for a media clone. */
  newDocuments: readonly TimelineDocument[];
}>;

export type CloneDeps = Readonly<{
  /** Cached read of a timeline document. The caller ensures the whole subtree
   *  is loaded first, so this never needs to fetch. */
  readDocument: (timelineId: string) => TimelineDocument | null;
  /** A fresh, graph-unique id for the given prefix. */
  mintId: (prefix: string) => string;
}>;

/**
 * Fields that must NOT survive a clone: `sourceClipId` pins the clip's stored
 * id (reusing it would collide with the source clip in a shared parent), and
 * `duplicateOfTimelineId` marks a reference to another timeline (the clone is
 * independent — it points at its own fresh document instead).
 */
function stripCloneOnlyFields(detail: ClipDetail): ClipDetail {
  const { sourceClipId: _sourceClipId, duplicateOfTimelineId: _dup, ...rest } = detail;
  return rest;
}

/**
 * Deep-clone a timeline document and every collection it contains, minting a
 * fresh id for each document and each clip. Returns the new ROOT id and every
 * new document (nested first). A missing source document (should not happen —
 * the caller ensures the subtree) clones as an empty timeline so a drill-in
 * never 404s.
 *
 * The memo preserves the source's SHARING TOPOLOGY: the clone id is allocated
 * and recorded BEFORE descending, so a child referenced twice resolves to ONE
 * cloned document both times (rather than silently forking into two), and a
 * cycle (only possible in corrupt data) resolves to the in-flight clone id —
 * never to the source id, which would wire a live reference to the original
 * into an allegedly independent copy.
 */
function cloneDocumentTree(
  rootId: string,
  deps: CloneDeps,
): { newId: string; documents: TimelineDocument[] } {
  const documents: TimelineDocument[] = [];
  const cloneIdBySource = new Map<string, string>();

  function clone(srcId: string): string {
    const existing = cloneIdBySource.get(srcId);
    if (existing !== undefined) return existing;
    const newId = deps.mintId("timeline");
    cloneIdBySource.set(srcId, newId);
    const src = deps.readDocument(srcId);
    if (src === null) {
      documents.push({ id: newId, title: "Timeline", clips: [] });
      return newId;
    }
    const clips: TimelineClip[] = src.clips.map((clip) => {
      if (clip.kind !== "collection") {
        return { ...clip, id: deps.mintId(clip.kind) };
      }
      const childNewId = clone(clip.childTimelineId);
      return { ...clip, id: deps.mintId("clip"), childTimelineId: childNewId };
    });
    documents.push({ ...src, id: newId, clips });
    return newId;
  }

  return { newId: clone(rootId), documents };
}

/**
 * Build the fresh node (+ detail + any new documents) for inserting a copy of
 * `node` — the shared core of Duplicate and Paste. `detail` is the source
 * node's side-table entry, cloned onto the new node so the copy renders
 * identically; a collection additionally clones its whole document tree.
 */
export function cloneNodeForInsert(
  node: CollectionItemNode,
  detail: ClipDetail | undefined,
  deps: CloneDeps,
): CloneForInsert {
  if (node.kind === "media") {
    const id = parseNodeId(deps.mintId(node.mediaKind ?? "media"));
    const detailClone = detail === undefined ? undefined : stripCloneOnlyFields(detail);
    return { node: { ...node, id }, detail: detailClone, newDocuments: [] };
  }

  // A duplicate-reference points at another timeline; clone THAT document tree
  // so the copy is genuinely independent rather than a second reference.
  const sourceTimelineId = detail?.duplicateOfTimelineId ?? (node.id as string);
  const { newId, documents } = cloneDocumentTree(sourceTimelineId, deps);
  const clonedNode: CollectionItemNode = {
    id: parseNodeId(newId),
    kind: "collection",
    name: node.name,
  };
  // Placeholder: the seeded document holds the children, loaded on drill-in.
  const clonedDetail =
    detail === undefined ? undefined : { ...stripCloneOnlyFields(detail), hydrated: false };
  return { node: clonedNode, detail: clonedDetail, newDocuments: documents };
}
