import {
  getChildren,
  mediaDurationSeconds,
  type CollectionsGraph,
  type MediaNode,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

// Pure graph → structured-tree projection for read_timeline. No store, no
// details store — hydration is injected as a predicate so this unit-tests
// directly. Ids are treated as OPAQUE strings (never split/parsed).

export type TimelineTreeNode = Readonly<{
  id: string;
  kind: "media" | "collection";
  name: string;
  // media:
  mediaKind?: "image" | "video";
  src?: string;
  durationSeconds?: number;
  trimInSeconds?: number;
  trimOutSeconds?: number;
  fullDurationSeconds?: number;
  // collection:
  hydrated?: boolean;
  childCount?: number;
  children?: readonly TimelineTreeNode[];
}>;

export type TimelineTree = Readonly<{
  timeline: Readonly<{ id: string; title: string; focused: boolean }>;
  nodes: readonly TimelineTreeNode[];
}>;

/** `false` for an un-hydrated collection placeholder (a read on its id would
 *  otherwise need to lazy-load). Unknown ids default to hydrated. */
export type IsHydrated = (collectionId: string) => boolean;

export function buildTimelineTree(
  graph: CollectionsGraph,
  rootId: NodeId,
  focusedId: string,
  depth: number,
  isHydrated: IsHydrated,
): TimelineTree {
  const root = graph.nodesById.get(rootId);
  return {
    timeline: {
      id: String(rootId),
      title: root?.name ?? String(rootId),
      focused: String(rootId) === focusedId,
    },
    nodes: walk(graph, rootId, depth, isHydrated, new Set()),
  };
}

function walk(
  graph: CollectionsGraph,
  parentId: NodeId,
  depth: number,
  isHydrated: IsHydrated,
  ancestors: ReadonlySet<string>,
): TimelineTreeNode[] {
  const out: TimelineTreeNode[] = [];
  for (const id of getChildren(graph, parentId)) {
    const node = graph.nodesById.get(id);
    if (!node) continue;
    if (node.kind === "media") {
      out.push(mediaTreeNode(node));
    } else {
      out.push(collectionTreeNode(graph, id, node.name, depth, isHydrated, ancestors));
    }
  }
  return out;
}

function mediaTreeNode(node: MediaNode): TimelineTreeNode {
  if (node.mediaKind === "video") {
    return {
      id: String(node.id),
      kind: "media",
      name: node.name,
      mediaKind: "video",
      src: node.src,
      durationSeconds: mediaDurationSeconds(node),
      trimInSeconds: node.trimInSeconds,
      trimOutSeconds: node.trimOutSeconds,
      fullDurationSeconds: node.fullDurationSeconds,
    };
  }
  return {
    id: String(node.id),
    kind: "media",
    name: node.name,
    mediaKind: "image",
    src: node.src,
    durationSeconds: mediaDurationSeconds(node),
  };
}

function collectionTreeNode(
  graph: CollectionsGraph,
  id: NodeId,
  name: string,
  depth: number,
  isHydrated: IsHydrated,
  ancestors: ReadonlySet<string>,
): TimelineTreeNode {
  const idStr = String(id);
  const hydrated = isHydrated(idStr);
  const base: TimelineTreeNode = {
    id: idStr,
    kind: "collection",
    name,
    hydrated,
    childCount: getChildren(graph, id).length,
  };
  // Expand only within depth, only hydrated collections, and never revisit an
  // ancestor id (guards a reference-shared / malformed cyclic graph).
  if (depth > 1 && hydrated && !ancestors.has(idStr)) {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(idStr);
    return { ...base, children: walk(graph, id, depth - 1, isHydrated, nextAncestors) };
  }
  return base;
}
