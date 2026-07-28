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
  AssetSourceRef,
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
  TrashOrigin,
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
  /** Which asset-provider file this media clip came from — pure provenance
   *  (the engine never reads it), round-tripped like poster. */
  sourceAsset?: AssetSourceRef;
  /** When this clip was trashed, and from where. Provenance again: the engine
   *  never reads it, so it rides the side-table rather than the graph node —
   *  the same seam `sourceAsset` uses, and for the same reason. */
  trashedAt?: string;
  trashedFrom?: TrashOrigin;
  itemCount?: number;
  previewItems?: CollectionTimelineClip["previewItems"];
  /** The collection clip's own display duration in its parent timeline — its
   *  LAYOUT span, disabled descendants included. */
  duration?: number;
  /** Of that span, the seconds that actually play. Absent when nothing under
   *  the collection is disabled (then `duration` already is it). */
  playableDuration?: number;
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
      ...(clip.disabled ? { disabled: true } : {}),
    };
  }
  return {
    kind: "media",
    id: clip.id,
    name: clip.alt,
    src: clip.src,
    durationSeconds: clip.duration,
    ...(clip.disabled ? { disabled: true } : {}),
  };
}

function mediaDetail(clip: Exclude<TimelineClip, CollectionTimelineClip>): ClipDetail {
  return {
    alt: clip.alt,
    aspect: clip.aspect,
    trackIndex: clip.trackIndex,
    ...(clip.poster === undefined ? {} : { poster: clip.poster }),
    ...(clip.sourceAsset === undefined ? {} : { sourceAsset: clip.sourceAsset }),
    ...(clip.trashedAt === undefined ? {} : { trashedAt: clip.trashedAt }),
    ...(clip.trashedFrom === undefined ? {} : { trashedFrom: clip.trashedFrom }),
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
    ...(clip.trashedAt === undefined ? {} : { trashedAt: clip.trashedAt }),
    ...(clip.trashedFrom === undefined ? {} : { trashedFrom: clip.trashedFrom }),
    sourceClipId: clip.id,
    itemCount: clip.itemCount,
    ...(clip.previewItems === undefined ? {} : { previewItems: clip.previewItems }),
    duration: clip.duration,
    ...(clip.playableDuration === undefined
      ? {}
      : { playableDuration: clip.playableDuration }),
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
      return {
        kind: "collection",
        id: clip.id,
        name: clip.title,
        children: [],
        ...(clip.disabled ? { disabled: true } : {}),
      };
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
        ...(clip.disabled ? { disabled: true } : {}),
      };
    }

    if (!childDoc) ctx.missing.push(childId);
    ctx.details[childId] = collectionDetail(clip, false);
    return {
      kind: "collection",
      id: childId,
      name: clip.title,
      children: [],
      ...(clip.disabled ? { disabled: true } : {}),
    };
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
 * Content length of a HYDRATED collection, derived from its live children
 * with the projection's own packing (leading padding, fixed gaps) — media by
 * the engine's trims, nested collections recursively when hydrated, else by
 * their stored summary.
 *
 * This exists because a stored summary goes stale the moment the CHILD
 * document is edited: writes are patch-scoped, so editing inside a child
 * never rewrites the parent, and the parent's collection clip keeps the old
 * `duration` indefinitely. Parroting it did two kinds of damage — the
 * preview clock drifted off the manifest (which derives from child content),
 * and, because the write path persists documents THROUGH this projection,
 * the parent's next unrelated write RE-PERSISTED the stale number. Deriving
 * from the live graph makes the projection agree with the manifest wherever
 * the session has real knowledge, and writes become self-healing.
 */
export function hydratedCollectionDuration(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: NodeId,
): number {
  let total = TIMELINE_LEADING_PADDING_SECONDS;
  let first = true;
  for (const childId of getChildren(graph, collectionId)) {
    const node = graph.nodesById.get(childId);
    if (!node) continue;
    if (!first) total += CLIP_GAP_SECONDS;
    first = false;
    if (node.kind === "media") {
      total += mediaDurationSeconds(node);
      continue;
    }
    const detail = details[childId as string];
    total += detail?.hydrated
      ? hydratedCollectionDuration(graph, details, childId)
      : (detail?.duration ?? 3);
  }
  return total;
}

/**
 * The same walk, restricted to what actually PLAYS: disabled children (and
 * everything under them) contribute neither their seconds nor their gap.
 *
 * The twin of `hydratedCollectionDuration`, and the split matters —that one
 * is GEOMETRY, feeding the collection clip's `duration` in the projection, so
 * it has to keep counting disabled children or the card would lose the slot
 * the playhead jumps over. This one is a READOUT, for the card's badge and the
 * selection total, where the honest number is what a viewer would sit through.
 *
 * Falls back to the stored `playableDuration` summary for an unhydrated child
 * (see deriveCollectionSummaries), then to `duration` for documents written
 * before the field existed — where nothing is disabled the two are equal
 * anyway, so the fallback is exact rather than approximate.
 */
export function hydratedCollectionPlayableDuration(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: NodeId,
): number {
  let total = TIMELINE_LEADING_PADDING_SECONDS;
  let first = true;
  for (const childId of getChildren(graph, collectionId)) {
    const node = graph.nodesById.get(childId);
    if (!node) continue;
    if (node.disabled === true) continue;
    if (!first) total += CLIP_GAP_SECONDS;
    first = false;
    if (node.kind === "media") {
      total += mediaDurationSeconds(node);
      continue;
    }
    const detail = details[childId as string];
    total += detail?.hydrated
      ? hydratedCollectionPlayableDuration(graph, details, childId)
      : (detail?.playableDuration ?? detail?.duration ?? 3);
  }
  return total;
}

/**
 * Preview frames of a hydrated collection, derived recursively from its live
 * descendants. Persisting the same result makes collection-only ancestors
 * self-healing after edits instead of baking a stale or blank summary back
 * into storage.
 */
function hydratedCollectionPreviewItems(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: NodeId,
): CollectionTimelineClip["previewItems"] {
  return [...hydratedCollectionPreviews(graph, collectionId as string, details)];
}

/** A collection card's preview frame: exactly the fields the card paints. */
export type CollectionPreviewFrame = Readonly<{
  id: string;
  kind: "image" | "video";
  src: string;
  poster?: string;
  trimIn?: number;
  alt: string;
}>;

/**
 * Preview frames for a HYDRATED collection CARD, derived from its LIVE media
 * children instead of the stored summary in the side-table.
 *
 * The graph card renders `detail.previewItems`, which the adapter seeds from
 * the stored collection clip — so once a loaded child is edited (add, delete,
 * reorder) the parent card kept showing the stored frames until a reload,
 * even though the write path (`graphChildrenToClips`) already re-derives them.
 * Deriving the card's frames here from the live children closes that gap, the
 * same way the card already prefers the live child COUNT over the stored
 * `itemCount` once hydrated. Placeholders have no live children, so callers
 * keep their stored summary.
 *
 * Media source URLs live on graph nodes. The optional details table adds the
 * image poster and display alt text when this helper is used for persistence.
 *
 * RECURSES into sub-collections: a collection whose direct children are all
 * nested collections has no media of its own to show, so the walk descends
 * depth-first (in child order) to surface the first nested image — and the
 * rest, from which first/middle/last is picked. A placeholder sub-collection
 * has no children in the graph, so the descent stops there naturally (its
 * nested media aren't loaded and can't be shown until it hydrates). The
 * persisted recursive summary then lets higher, unhydrated ancestors reuse
 * the resolved descendant frame.
 */
export function hydratedCollectionPreviews(
  graph: CollectionsGraph,
  collectionId: string,
  details?: DetailsById,
): readonly CollectionPreviewFrame[] {
  const media: CollectionPreviewFrame[] = [];
  const seen = new Set<string>([collectionId]);
  const collect = (id: NodeId): void => {
    for (const childId of getChildren(graph, id)) {
      const node = graph.nodesById.get(childId);
      if (!node) continue;
      if (node.kind === "media") {
        const detail = details?.[node.id as string];
        const src = node.src?.trim() ?? "";
        const poster =
          node.mediaKind === "video"
            ? node.posterSrcs?.find((candidate) => candidate.trim().length > 0)
            : detail?.poster;
        if (node.mediaKind === "video" ? poster === undefined : src.length === 0) {
          continue;
        }
        media.push({
          id: node.id as string,
          kind: node.mediaKind === "video" ? "video" : "image",
          src,
          ...(poster === undefined ? {} : { poster }),
          ...(node.mediaKind === "video" && node.trimInSeconds > 0
            ? { trimIn: node.trimInSeconds }
            : {}),
          alt: detail?.alt ?? node.name,
        });
      } else if (node.kind === "collection") {
        // Descend to find nested images. `seen` guards a pathological cycle
        // (the graph is a tree, so this is belt-and-braces).
        const key = node.id as string;
        if (!seen.has(key)) {
          seen.add(key);
          collect(childId);
        }
      }
    }
  };
  collect(parseNodeId(collectionId));
  if (media.length <= 3) return media;
  return [media[0], media[Math.floor(media.length / 2)], media[media.length - 1]];
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
        ...(detail?.sourceAsset === undefined ? {} : { sourceAsset: detail.sourceAsset }),
        ...(detail?.trashedAt === undefined ? {} : { trashedAt: detail.trashedAt }),
        ...(detail?.trashedFrom === undefined ? {} : { trashedFrom: detail.trashedFrom }),
        // Read from the NODE, not `detail`: disabling goes through a graph
        // command, so the flag rides the patch/undo path like a rename does.
        ...(node.disabled ? { disabled: true } : {}),
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
    // Hydrated collections DERIVE their duration from live children (see
    // hydratedCollectionDuration) — the same stale-summary rule itemCount
    // below already follows; placeholders keep the stored summary, it is all
    // anyone knows about them.
    const duration = detail?.hydrated
      ? hydratedCollectionDuration(graph, details, node.id)
      : (detail?.duration ?? 3);
    // Hydrated collections DERIVE their preview frames from live children (see
    // hydratedCollectionPreviewItems) — same stale-summary rule duration and
    // itemCount already follow; placeholders keep the stored summary.
    const previewItems = detail?.hydrated
      ? hydratedCollectionPreviewItems(graph, details, node.id)
      : detail?.previewItems;
    // The playable READOUT beside the layout duration above, derived live for
    // the same self-healing reason. Omitted when it equals the layout span, so
    // a closure with nothing disabled never grows the field.
    const playable = detail?.hydrated
      ? hydratedCollectionPlayableDuration(graph, details, node.id)
      : detail?.playableDuration;
    const playableDuration = playable === duration ? undefined : playable;
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
      ...(previewItems === undefined ? {} : { previewItems }),
      ...(playableDuration === undefined ? {} : { playableDuration }),
      alt: detail?.alt ?? `${node.name} collection`,
      aspect: detail?.aspect ?? 16 / 9,
      trackIndex: detail?.trackIndex ?? 0,
      startTime,
      duration,
      sourceDuration: detail?.sourceDuration ?? duration,
      trimIn: detail?.trimIn ?? 0,
      trimOut: detail?.trimOut ?? 0,
      ...(node.disabled ? { disabled: true } : {}),
      ...(detail?.trashedAt === undefined ? {} : { trashedAt: detail.trashedAt }),
      ...(detail?.trashedFrom === undefined ? {} : { trashedFrom: detail.trashedFrom }),
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
  // Only the PLACING commands can land content somewhere. Checked positively
  // rather than by excluding the data commands one at a time, so a new
  // command type defaults to "places nothing" instead of failing to compile
  // (or worse, being forgotten).
  if (command.type !== "move-nodes" && command.type !== "add-nodes") return [];
  const target = command.toParentId as string;
  return details[target]?.hydrated === false ? [target] : [];
}

/**
 * The collections whose stored documents a committed change touches — the
 * patch-scoped persistence write set.
 *
 * Includes every ANCESTOR of a directly-touched collection, because the
 * write path derives a hydrated collection's summary (duration, itemCount)
 * from its live children: an edit inside C changes the projected clips of
 * C's parent, and transitively every document up to the focused root. Before
 * this closure, a child-only trim never rewrote the parent, so the stored
 * summary stayed stale and the server manifest — compiled from stored parent
 * spans — kept playing the pre-edit total no matter how fresh its compile.
 */
export function collectAffectedCollectionIds(
  graph: CollectionsGraph,
  patch: CollectionsPatch,
): readonly string[] {
  const ids = new Set<string>();
  const addWithAncestors = (nodeId: NodeId | null | undefined) => {
    let current = nodeId;
    while (current !== undefined && current !== null && !ids.has(current as string)) {
      ids.add(current as string);
      current = graph.parentById.get(current);
    }
  };
  const parentOf = (nodeId: NodeId) => addWithAncestors(graph.parentById.get(nodeId));

  switch (patch.type) {
    case "nodes-moved":
      for (const move of patch.moves) {
        addWithAncestors(move.fromParentId);
        addWithAncestors(move.toParentId);
      }
      break;
    case "nodes-added":
      for (const add of patch.adds) addWithAncestors(add.parentId);
      break;
    case "nodes-removed":
      for (const removal of patch.removals) addWithAncestors(removal.parentId);
      break;
    case "nodes-updated":
      for (const update of patch.updates) parentOf(update.nodeId);
      break;
  }
  return [...ids];
}
