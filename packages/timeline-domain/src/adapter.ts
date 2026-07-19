// TimelineDocument ⇄ CollectionsGraph adapter — the storage/hydration seam of
// docs/storyboard-graph-architecture.md.
//
// The stored model (packages/ui/timeline): a map of TimelineDocuments, each a
// flat TimelineClip[] where a collection clip references its child document
// by `childTimelineId`. Semantically that is a containment forest — exactly
// the graph — so this adapter:
//
//   - builds a graph rooted at the FOCUSED timeline (drill-in navigation is
//     the hydration trigger), hydrating a bounded number of child levels;
//     deeper collections become PLACEHOLDER nodes (empty children) until
//     focused/expanded;
//   - keeps the app-level fields the engine doesn't model (aspect, alt,
//     posters, collection previews/counts…) in a side-table keyed by node id
//     — the "does the engine touch it?" rule: durations/trims/src live on
//     media nodes (the engine mutates them), everything else lives here;
//   - projects a collection's children back to TimelineClip[] with derived
//     startTime/index (packing math identical to packTimelineClips), which
//     is the persistence write path.
//
// Identity rule: a collection clip IS its child timeline — the graph node id
// is the childTimelineId. The legacy clip's own id is preserved in the
// side-table (`sourceClipId`) for round-trips. If the same child is
// referenced twice inside one hydrated area (the multi-parent case the
// architecture assumes away), the duplicate becomes a non-navigable
// reference card keyed by the clip's own id — surfaced, not crashed on.

import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "@storyboard/timeline-model/constants";
import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "@storyboard/timeline-model/types";

import {
  buildGraph,
  getChildren,
  mediaDurationSeconds,
  parseNodeId,
  type CollectionsCommand,
  type CollectionsGraph,
  type CollectionsPatch,
  type GraphNodeSpec,
  type NodeId,
} from "./engine";

export type DocumentsById = Readonly<Record<string, TimelineDocument>>;

/** App-level clip detail the graph deliberately doesn't model. */
export type ClipDetail = Readonly<{
  alt: string;
  aspect: number;
  trackIndex: number;
  poster?: string;
  playbackStartTime?: number;
  playbackDuration?: number;
  /** Image round-trip extras (the engine only stores an image's duration). */
  sourceDuration?: number;
  trimIn?: number;
  trimOut?: number;
  /** The stored clip's own id, when it differs from the node id: every
   *  collection clip (node id = childTimelineId), and any DEMOTED duplicate
   *  media clip. The write path round-trips it. */
  sourceClipId?: string;
  itemCount?: number;
  previewItems?: CollectionTimelineClip["previewItems"];
  /** The collection clip's own display duration in its parent timeline. */
  duration?: number;
  /** False for placeholder collections awaiting hydration. */
  hydrated?: boolean;
  /** Set on a duplicate-reference card (see module comment). */
  duplicateOfTimelineId?: string;
}>;

export type DetailsById = Readonly<Record<string, ClipDetail>>;

export type FocusedGraph = Readonly<{
  graph: CollectionsGraph;
  details: DetailsById;
  /** Referenced child timeline ids that had no document (left placeholders). */
  missingDocuments: readonly string[];
}>;

export type BuildFocusedGraphResult =
  | Readonly<{ ok: true; value: FocusedGraph }>
  | Readonly<{ ok: false; error: string }>;

type BuildContext = {
  documents: DocumentsById;
  details: Record<string, ClipDetail>;
  missing: string[];
  /** Node ids already used in the built area — duplicate references demote. */
  used: Set<string>;
};

function mediaSpec(clip: Exclude<TimelineClip, CollectionTimelineClip>): GraphNodeSpec {
  if (clip.kind === "video") {
    return {
      kind: "media",
      mediaKind: "video",
      id: clip.id,
      name: clip.alt,
      src: clip.src,
      posterSrcs: clip.poster === undefined ? undefined : [clip.poster],
      fullDurationSeconds: clip.sourceDuration,
      trimInSeconds: clip.trimIn,
      trimOutSeconds: clip.trimOut,
    };
  }
  return {
    kind: "media",
    id: clip.id,
    name: clip.alt,
    src: clip.src,
    durationSeconds: clip.duration,
  };
}

function mediaDetail(clip: Exclude<TimelineClip, CollectionTimelineClip>): ClipDetail {
  return {
    alt: clip.alt,
    aspect: clip.aspect,
    trackIndex: clip.trackIndex,
    ...(clip.poster === undefined ? {} : { poster: clip.poster }),
    ...(clip.playbackStartTime === undefined ? {} : { playbackStartTime: clip.playbackStartTime }),
    ...(clip.playbackDuration === undefined ? {} : { playbackDuration: clip.playbackDuration }),
    ...(clip.kind === "image"
      ? { sourceDuration: clip.sourceDuration, trimIn: clip.trimIn, trimOut: clip.trimOut }
      : {}),
  };
}

function collectionDetail(clip: CollectionTimelineClip, hydrated: boolean): ClipDetail {
  return {
    alt: clip.alt,
    aspect: clip.aspect,
    trackIndex: clip.trackIndex,
    sourceClipId: clip.id,
    itemCount: clip.itemCount,
    ...(clip.previewItems === undefined ? {} : { previewItems: clip.previewItems }),
    duration: clip.duration,
    sourceDuration: clip.sourceDuration,
    trimIn: clip.trimIn,
    trimOut: clip.trimOut,
    hydrated,
  };
}

function clipSpecs(
  ctx: BuildContext,
  doc: TimelineDocument,
  hydrateLevels: number,
): GraphNodeSpec[] {
  return doc.clips.map((clip) => {
    if (clip.kind !== "collection") {
      let nodeId = clip.id;
      if (ctx.used.has(nodeId)) {
        // Duplicated media id: the legacy views mint STABLE per-asset clip
        // ids, so the same asset placed in two documents (or twice in one)
        // collides — and node ids must be graph-unique. Demote to a
        // synthetic id, like duplicate collection references demote,
        // instead of letting store.hydrate reject the whole payload (which
        // silently blanked the collection). `sourceClipId` preserves the
        // stored id, so the write path round-trips it unchanged.
        nodeId = `dup:${doc.id}:${clip.id}`;
        while (ctx.used.has(nodeId)) nodeId = `${nodeId}~`;
      }
      ctx.used.add(nodeId);
      ctx.details[nodeId] =
        nodeId === clip.id
          ? mediaDetail(clip)
          : { ...mediaDetail(clip), sourceClipId: clip.id };
      return { ...mediaSpec(clip), id: nodeId };
    }

    const childId = clip.childTimelineId;
    if (ctx.used.has(childId)) {
      // Same child referenced twice inside the hydrated area: demote to a
      // non-navigable reference card keyed by the clip's own id.
      ctx.used.add(clip.id);
      ctx.details[clip.id] = {
        ...collectionDetail(clip, false),
        duplicateOfTimelineId: childId,
      };
      return { kind: "collection", id: clip.id, name: clip.title, children: [] };
    }
    ctx.used.add(childId);

    const childDoc = ctx.documents[childId];
    if (childDoc && hydrateLevels > 0) {
      ctx.details[childId] = collectionDetail(clip, true);
      return {
        kind: "collection",
        id: childId,
        name: clip.title,
        children: clipSpecs(ctx, childDoc, hydrateLevels - 1),
      };
    }

    if (!childDoc) ctx.missing.push(childId);
    ctx.details[childId] = collectionDetail(clip, false);
    return { kind: "collection", id: childId, name: clip.title, children: [] };
  });
}

export type HydrationSpecs = Readonly<{
  /** Child specs for the timeline — feed them to `store.hydrate(timelineId, specs)`. */
  specs: readonly GraphNodeSpec[];
  /** Side-table entries for every spec'd node — merge into the app's details map. */
  details: DetailsById;
  missingDocuments: readonly string[];
}>;

export type BuildHydrationSpecsResult =
  | Readonly<{ ok: true; value: HydrationSpecs }>
  | Readonly<{ ok: false; error: string }>;

/**
 * Build the child specs for ONE timeline document — the incremental
 * hydration payload for `store.hydrate` when a placeholder collection gets
 * focused or expanded mid-session. `hydrateChildLevels` behaves as in
 * `buildFocusedGraph`. Pass the LIVE graph's node ids as `usedIds` so a
 * child referenced elsewhere in the graph demotes to a reference card
 * instead of colliding.
 */
export function buildHydrationSpecs(
  documents: DocumentsById,
  timelineId: string,
  hydrateChildLevels = 1,
  usedIds?: Iterable<string>,
): BuildHydrationSpecsResult {
  const doc = documents[timelineId];
  if (!doc) {
    return { ok: false, error: `Unknown timeline document "${timelineId}".` };
  }
  const ctx: BuildContext = {
    documents,
    details: {},
    missing: [],
    used: new Set(usedIds),
  };
  ctx.used.add(timelineId);
  const specs = clipSpecs(ctx, doc, hydrateChildLevels);
  return {
    ok: true,
    value: { specs, details: ctx.details, missingDocuments: ctx.missing },
  };
}

/**
 * Build the graph for a focused timeline (drill-in navigation target).
 * `hydrateChildLevels` controls how many collection levels below the focused
 * timeline are loaded (default 1: the focused clips plus each child
 * collection's own children, so inline sub-timeline expansion needs no
 * further fetch). Deeper collections are placeholders.
 */
export function buildFocusedGraph(
  documents: DocumentsById,
  focusedId: string,
  hydrateChildLevels = 1,
): BuildFocusedGraphResult {
  const focusedDoc = documents[focusedId];
  if (!focusedDoc) {
    return { ok: false, error: `Unknown timeline document "${focusedId}".` };
  }

  const children = buildHydrationSpecs(documents, focusedId, hydrateChildLevels);
  if (!children.ok) return children;
  const rootSpec: GraphNodeSpec = {
    kind: "collection",
    id: focusedId,
    name: focusedDoc.title,
    children: children.value.specs,
  };

  const built = buildGraph([rootSpec]);
  if (!built.ok) {
    return { ok: false, error: `Could not build graph: ${JSON.stringify(built.error)}` };
  }
  return {
    ok: true,
    value: {
      graph: built.value,
      details: children.value.details,
      missingDocuments: children.value.missingDocuments,
    },
  };
}

/**
 * Project a collection's children back to TimelineClip[] — the persistence
 * write path. `startTime`/`index` are DERIVED with the same packing math as
 * `packTimelineClips` (leading padding, fixed gap); durations come from the
 * graph's media nodes (the engine's trims are the truth), everything else
 * from the side-table.
 */
export function graphChildrenToClips(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: string,
): TimelineClip[] {
  let nextStartTime = TIMELINE_LEADING_PADDING_SECONDS;

  return getChildren(graph, parseNodeId(collectionId)).map((childId, index) => {
    const node = graph.nodesById.get(childId);
    if (!node) throw new Error(`Graph child "${childId}" missing from nodesById.`);
    const detail = details[childId];
    const startTime = nextStartTime;

    if (node.kind === "media") {
      const duration = mediaDurationSeconds(node);
      nextStartTime += duration + CLIP_GAP_SECONDS;
      const base = {
        // A demoted duplicate (see clipSpecs) writes back its STORED id.
        id: detail?.sourceClipId ?? (node.id as string),
        index,
        alt: detail?.alt ?? node.name,
        aspect: detail?.aspect ?? 16 / 9,
        trackIndex: detail?.trackIndex ?? 0,
        startTime,
        duration,
        ...(detail?.playbackStartTime === undefined
          ? {}
          : { playbackStartTime: detail.playbackStartTime }),
        ...(detail?.playbackDuration === undefined
          ? {}
          : { playbackDuration: detail.playbackDuration }),
      };
      if (node.mediaKind === "video") {
        return {
          ...base,
          kind: "video",
          src: node.src ?? "",
          ...(detail?.poster === undefined ? {} : { poster: detail.poster }),
          sourceDuration: node.fullDurationSeconds,
          trimIn: node.trimInSeconds,
          trimOut: node.trimOutSeconds,
        };
      }
      return {
        ...base,
        kind: "image",
        src: node.src ?? "",
        ...(detail?.poster === undefined ? {} : { poster: detail.poster }),
        sourceDuration: detail?.sourceDuration ?? duration,
        trimIn: detail?.trimIn ?? 0,
        trimOut: detail?.trimOut ?? 0,
      };
    }

    // Collection node → collection clip referencing it as the child timeline.
    const duration = detail?.duration ?? 3;
    nextStartTime += duration + CLIP_GAP_SECONDS;
    return {
      id: detail?.sourceClipId ?? (node.id as string),
      index,
      kind: "collection",
      title: node.name,
      childTimelineId: detail?.duplicateOfTimelineId ?? (node.id as string),
      // Hydrated collections report their LIVE child count (nesting a clip
      // into one must not persist the stale stored count); placeholders keep
      // the stored count — their emptiness is unhydrated, not real.
      itemCount: detail?.hydrated
        ? getChildren(graph, node.id).length
        : (detail?.itemCount ?? getChildren(graph, node.id).length),
      ...(detail?.previewItems === undefined ? {} : { previewItems: detail.previewItems }),
      alt: detail?.alt ?? `${node.name} collection`,
      aspect: detail?.aspect ?? 16 / 9,
      trackIndex: detail?.trackIndex ?? 0,
      startTime,
      duration,
      sourceDuration: detail?.sourceDuration ?? duration,
      trimIn: detail?.trimIn ?? 0,
      trimOut: detail?.trimOut ?? 0,
    };
  });
}

/**
 * The destination collections of a PROPOSED command that are still
 * UN-hydrated placeholders — their stored clips haven't loaded, so letting
 * content land in them both blocks their future hydration (the engine
 * refuses to fill a non-empty collection) and, worse, would let the
 * patch-scoped write overwrite the stored document with only the new
 * content.
 *
 * This reads the COMMAND, not the resulting patch, because the gate has to
 * be a pre-commit veto (`commandPolicy`). Reverting after the fact by
 * undoing is not equivalent: the commit has already discarded the redo
 * branch by then. A command carries a single `toParentId`, so this is also
 * strictly simpler than the patch it would have produced.
 *
 * Unknown ids are ALLOWED — only an explicit `hydrated: false` blocks. A
 * collection nobody has recorded details for is not a known placeholder.
 */
export function collectUnhydratedDropTargets(
  command: CollectionsCommand,
  details: DetailsById,
): readonly string[] {
  // update-media places nothing anywhere; it only re-trims in place.
  if (command.type === "update-media") return [];
  const target = command.toParentId as string;
  return details[target]?.hydrated === false ? [target] : [];
}

/**
 * The collections whose stored documents a committed change touches — the
 * patch-scoped persistence write set.
 */
export function collectAffectedCollectionIds(
  graph: CollectionsGraph,
  patch: CollectionsPatch,
): readonly string[] {
  const ids = new Set<string>();
  const parentOf = (nodeId: NodeId) => {
    const parent = graph.parentById.get(nodeId);
    if (parent !== undefined && parent !== null) ids.add(parent as string);
  };

  switch (patch.type) {
    case "nodes-moved":
      for (const move of patch.moves) {
        ids.add(move.fromParentId as string);
        ids.add(move.toParentId as string);
      }
      break;
    case "nodes-added":
      for (const add of patch.adds) ids.add(add.parentId as string);
      break;
    case "nodes-removed":
      for (const removal of patch.removals) ids.add(removal.parentId as string);
      break;
    case "nodes-updated":
      for (const update of patch.updates) parentOf(update.nodeId);
      break;
  }
  return [...ids];
}
