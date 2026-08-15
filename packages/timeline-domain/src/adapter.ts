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
import { tagsField } from "@storyboard/timeline-model/tags";
// The lane normaliser the model packs with. Imported rather than re-derived:
// this file's packing is the twin of `packTimelineClips`, and two different
// answers to "which lane is this clip on" would move layered clips on save.
import { placedStartOf, trackIndexOf } from "@storyboard/timeline-model/documents";
import { layerFrameOf } from "@storyboard/timeline-model/layer-frame";
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
  /** The user's own name for this clip, when they gave it one. Absent means
   *  unnamed — which is what the card reads to decide whether to show a name
   *  at all, so "" and undefined are not interchangeable here. */
  title?: string;
  aspect: number;
  // NO trackIndex / placedStart. They live on the NODE now — see
  // `placementSpec`. The engine mutates them through `set-node-placement`,
  // which is what makes a lane change undoable, and the side-table is for
  // fields the engine never touches.
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
  /** Free-form labels for finding this clip again. Provenance like
   *  `sourceAsset`: the engine never reads them, so they ride the side-table
   *  rather than the graph node, and no graph command is needed to change
   *  them. Absent means untagged; an empty list is never stored. */
  tags?: string[];
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

/**
 * Lane and placement, for the NODE spec.
 *
 * These moved off the detail side-table and onto the node when they became a
 * command (`set-node-placement`), which is what makes them undoable. The rule
 * the side-table follows is "does the ENGINE MUTATE it" — not "does the engine
 * understand it" — and the engine now mutates these, so they belong here
 * beside `disabled`, which is the same kind of fact for the same reason.
 *
 * The STORED clip is unchanged: both fields were already clip fields, so this
 * only reroutes which side of the seam carries them. No data migration.
 */
function placementSpec(
  clip: Pick<TimelineClip, "trackIndex" | "placedStart" | "layerFrame">,
): Readonly<{
  trackIndex?: number;
  placedStart?: number;
  layerFrame?: Readonly<{ x: number; y: number; width: number }>;
}> {
  return {
    ...(clip.trackIndex === undefined ? {} : { trackIndex: clip.trackIndex }),
    ...(clip.placedStart === undefined ? {} : { placedStart: clip.placedStart }),
    ...(clip.layerFrame === undefined ? {} : { layerFrame: clip.layerFrame }),
  };
}

function mediaSpec(clip: Exclude<TimelineClip, CollectionTimelineClip>): GraphNodeSpec {
  if (clip.kind === "video") {
    return {
      kind: "media",
      mediaKind: "video",
      id: clip.id,
      name: clip.title ?? clip.alt,
      src: clip.src,
      posterSrcs: clip.poster === undefined ? undefined : [clip.poster],
      fullDurationSeconds: clip.sourceDuration,
      trimInSeconds: clip.trimIn,
      trimOutSeconds: clip.trimOut,
      ...(clip.disabled ? { disabled: true } : {}),
      ...placementSpec(clip),
    };
  }
  if (clip.kind === "audio") {
    // WINDOWED like video, not duration-only like image: the trims live on the
    // node so `mediaDurationSeconds` computes the cut. Storing a single
    // duration here would make shipping a trim handle a data migration. No
    // posterSrcs — audio has no frames.
    return {
      kind: "media",
      mediaKind: "audio",
      id: clip.id,
      name: clip.title ?? clip.alt,
      src: clip.src,
      fullDurationSeconds: clip.sourceDuration,
      trimInSeconds: clip.trimIn,
      trimOutSeconds: clip.trimOut,
      ...(clip.disabled ? { disabled: true } : {}),
      ...placementSpec(clip),
    };
  }
  return {
    kind: "media",
    id: clip.id,
    name: clip.title ?? clip.alt,
    src: clip.src,
    durationSeconds: clip.duration,
    ...(clip.disabled ? { disabled: true } : {}),
    ...placementSpec(clip),
  };
}

function mediaDetail(clip: Exclude<TimelineClip, CollectionTimelineClip>): ClipDetail {
  return {
    alt: clip.alt,
    ...(clip.title === undefined ? {} : { title: clip.title }),
    aspect: clip.aspect,
    ...(clip.poster === undefined ? {} : { poster: clip.poster }),
    ...(clip.sourceAsset === undefined ? {} : { sourceAsset: clip.sourceAsset }),
    ...tagsField(clip.tags),
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
    ...tagsField(clip.tags),
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
      //
      // That key is not enough on its own. A collection clip's stored id
      // normally EQUALS its childTimelineId (both the graph write-back and
      // `create_collection` mint them that way), so `clip.id` is usually the
      // very id that just collided — falling back to it reproduced the
      // duplicate and `buildGraph` rejected the whole tree, which blocked
      // every write to the project rather than surfacing one bad card. Fall
      // through to the same synthetic form the media branch uses.
      let nodeId = clip.id;
      if (ctx.used.has(nodeId)) {
        nodeId = `dup:${doc.id}:${clip.id}`;
        while (ctx.used.has(nodeId)) nodeId = `${nodeId}~`;
      }
      ctx.used.add(nodeId);
      // `sourceClipId` (from collectionDetail) and `duplicateOfTimelineId`
      // are what let the write path round-trip a synthetic id back to the
      // stored clip id and its real child pointer — see graphChildrenToClips.
      ctx.details[nodeId] = {
        ...collectionDetail(clip, false),
        duplicateOfTimelineId: childId,
      };
      return {
        kind: "collection",
        id: nodeId,
        name: clip.title,
        children: [],
        ...(clip.disabled ? { disabled: true } : {}),
        ...placementSpec(clip),
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
        ...placementSpec(clip),
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
      ...placementSpec(clip),
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
  stored: CollectionTimelineClip["previewItems"],
): CollectionTimelineClip["previewItems"] {
  const live = hydratedCollectionPreviews(graph, collectionId as string, details);
  return [...resolveCollectionPreviews(live, stored)];
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

/** What the live walk found, plus whether it could see everywhere it looked. */
export type CollectionPreviewsResult = Readonly<{
  frames: readonly CollectionPreviewFrame[];
  /**
   * The walk hit a collection with no children in the graph — an unloaded
   * branch — BEFORE it had found any media. So whatever ended up first in
   * `frames` is not necessarily the collection's first frame: the real one may
   * live in the branch that could not be read.
   *
   * Deliberately "before the first media", not "anywhere in the walk". A card
   * paints ONE frame (`useCollectionPreviewFrames`, PL13-003) and it is always
   * `frames[0]`, so an unloaded branch encountered AFTER the first media
   * cannot change anything anyone sees. Flagging those too would send a
   * perfectly good live result back to the stored summary and throw away the
   * user's just-made edits — the staleness this walk exists to fix.
   *
   * When `frames` is empty this is exactly the old `sawChildlessCollection`:
   * every childless collection was necessarily seen before a first media that
   * never arrived. That is why one field now covers both cases.
   */
  firstFrameUncertain: boolean;
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
): CollectionPreviewsResult {
  const media: CollectionPreviewFrame[] = [];
  const seen = new Set<string>([collectionId]);
  let firstFrameUncertain = false;
  const collect = (id: NodeId): void => {
    for (const childId of getChildren(graph, id)) {
      const node = graph.nodesById.get(childId);
      if (!node) continue;
      if (node.kind === "media") {
        // Audio can never be a preview FRAME. It has a `src`, so it would sail
        // through the `src.length === 0` test below and be written into the
        // collection's persisted `previewItems` as an image — and because this
        // projection self-heals back into storage, that mistake would re-persist
        // on every unrelated parent write rather than failing once.
        if (node.mediaKind === "audio") continue;
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
          // No children in the graph means its document has not been loaded —
          // or it is genuinely empty, and the two are indistinguishable from
          // here. Either way this walk cannot see media under it. Recorded so
          // an EMPTY result can be told apart from "looked and found nothing";
          // `resolveCollectionPreviews` explains why conflating the two is safe.
          // Only while nothing has been found yet — see `firstFrameUncertain`.
          if (media.length === 0 && getChildren(graph, childId).length === 0) {
            firstFrameUncertain = true;
          }
          collect(childId);
        }
      }
    }
  };
  collect(parseNodeId(collectionId));
  // Same shape as `previewItemsFrom`: pick INDICES and read them back through
  // a bounds check, rather than building an array of `T | undefined` and
  // asserting the holes away. All three are provably in range, so nothing is
  // dropped — but a future change to the arithmetic becomes a compile error
  // instead of a frame with undefined fields written into storage.
  const frameIndices =
    media.length <= 3
      ? media.map((_frame, index) => index)
      : [0, Math.floor(media.length / 2), media.length - 1];
  const frames = frameIndices.flatMap((index) => {
    const frame = media[index];
    return frame === undefined ? [] : [frame];
  });
  return { frames, firstFrameUncertain };
}

/**
 * Live preview frames, or the stored summary when the live walk could not see
 * far enough to produce them.
 *
 * The live walk is authoritative EXCEPT in one case: it returned nothing AND it
 * ran into a collection with no children in the graph. `hydrated` means "my own
 * children are loaded" — one level — but these frames come from leaf MEDIA,
 * which for a collection of collections is two or more levels down. So a
 * hydrated parent whose children are unhydrated collections walks, finds
 * nothing, and knows strictly LESS than the summary the server already derived
 * across the whole closure. Preferring the walk there blanked those cards.
 *
 * A childless collection might instead be genuinely empty, and the walk cannot
 * tell. Conflating them is safe: a genuinely empty child contributes nothing to
 * the server's summary either, so the stored frames agree with the live answer
 * and the fallback returns the same thing.
 *
 * What must keep working — and does — is a collection whose own media were all
 * deleted. No child collection is involved, so `firstFrameUncertain` stays
 * false, the empty result stands, and the card goes blank as it should. That is
 * the case a bare `frames.length === 0` check would have broken, resurrecting
 * stale frames on a collection the user just emptied.
 *
 * #293: a NON-EMPTY walk that never saw the START of the collection is now
 * covered by the same rule, because it has the same defect — it knows less
 * than the server's summary about the one frame that gets painted. A card
 * shows `frames[0]`, and if an unloaded branch sits before the first media
 * found, `frames[0]` belongs to a later branch and the true first frame was
 * never reachable. Whatever the user just edited in a loaded child cannot be
 * that frame either, so nothing fresh is lost by deferring.
 *
 * This is NOT "prefer stored whenever the walk is incomplete". An unloaded
 * branch AFTER the first media leaves `frames[0]` correct, so the live result
 * still wins — which is what keeps a just-made edit on screen. The
 * middle/last slots of such a walk can still be unrepresentative; they are not
 * rendered, and merging two ordered frame lists without duplicating media
 * needs a rule that does not exist yet.
 */
export function resolveCollectionPreviews(
  live: CollectionPreviewsResult,
  stored: readonly CollectionPreviewFrame[] | undefined,
): readonly CollectionPreviewFrame[] {
  if (!live.firstFrameUncertain) return live.frames;
  return stored ?? live.frames;
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
  // PER LANE, exactly as `packTimelineClips` does — this is the twin of that
  // math, and the two drifting is the whole reason the comment at the top of
  // this file insists they are identical. A graph write that packed one
  // sequence while the model packed lanes would move every layered clip the
  // moment it was saved.
  const nextStartByTrack = new Map<number, number>();
  const startFor = (track: number) =>
    nextStartByTrack.get(track) ?? TIMELINE_LEADING_PADDING_SECONDS;
  // The cursor never rewinds, exactly as in `packTimelineClips`: a clip
  // placed earlier than its lane's queue has reached must not drag the
  // following queued clip back on top of a neighbour.
  const advance = (track: number, end: number) =>
    nextStartByTrack.set(track, Math.max(startFor(track), end));

  return getChildren(graph, parseNodeId(collectionId)).map((childId, index) => {
    const node = graph.nodesById.get(childId);
    if (!node) throw new Error(`Graph child "${childId}" missing from nodesById.`);
    const detail = details[childId];
    // From the NODE, not the detail: these are engine-carried now.
    const trackIndex = trackIndexOf({ trackIndex: node.trackIndex ?? 0 });
    // PLACED or queued — the same resolution the model packer uses, imported
    // rather than re-implemented so the twins cannot drift on the one field
    // whose whole purpose is to override the cursor.
    const placedStart = placedStartOf({ placedStart: node.placedStart }, trackIndex);
    // Same rule as the two above, and the same reason for using the model's own
    // normalizer: this value is HONOURED, so a rectangle that is not one has to
    // become "no picture" rather than an inset nobody asked for. Lane 0 never
    // carries a frame — the picture is not inside itself.
    const layerFrame = trackIndex === 0 ? undefined : layerFrameOf(node.layerFrame);
    const startTime = placedStart ?? startFor(trackIndex);

    if (node.kind === "media") {
      const duration = mediaDurationSeconds(node);
      advance(trackIndex, startTime + duration + CLIP_GAP_SECONDS);
      const base = {
        // A demoted duplicate (see clipSpecs) writes back its STORED id.
        id: detail?.sourceClipId ?? (node.id as string),
        index,
        // `alt` stays the DERIVED description: a rename writes `title` (see
        // the persistence bridge), so accessibility text survives naming.
        // The `?? node.name` fallback is for nodes minted in-session, which
        // have no detail entry yet.
        alt: detail?.alt ?? node.name,
        ...(detail?.title === undefined ? {} : { title: detail.title }),
        aspect: detail?.aspect ?? 16 / 9,
        trackIndex,
        // THE WRITE-BACK, like tags: the stored clip is rebuilt from this
        // record, so omitting it here would silently un-place the clip on
        // the next save and drop it back into its lane's queue.
        ...(placedStart === undefined ? {} : { placedStart }),
        ...(layerFrame === undefined ? {} : { layerFrame }),
        startTime,
        duration,
        ...(detail?.playbackStartTime === undefined
          ? {}
          : { playbackStartTime: detail.playbackStartTime }),
        ...(detail?.playbackDuration === undefined
          ? {}
          : { playbackDuration: detail.playbackDuration }),
        ...(detail?.sourceAsset === undefined ? {} : { sourceAsset: detail.sourceAsset }),
        // THE WRITE-BACK. Tags live only on the detail, so without this line
        // they are dropped on every save — silently, because nothing else
        // reads them and no type would complain.
        ...tagsField(detail?.tags),
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
      if (node.mediaKind === "audio") {
        // THE WRITE-BACK. Without this branch an audio node falls through to
        // the image return below and is PERSISTED as `kind: "image"` — the
        // kind would be lost on every save, silently and permanently.
        // Trims come off the node (it is windowed), never off `detail`, which
        // is why mediaDetail correctly writes nothing for audio.
        return {
          ...base,
          kind: "audio",
          src: node.src ?? "",
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
      ? hydratedCollectionPreviewItems(graph, details, node.id, detail.previewItems)
      : detail?.previewItems;
    // The playable READOUT beside the layout duration above, derived live for
    // the same self-healing reason. Omitted when it equals the layout span, so
    // a closure with nothing disabled never grows the field.
    const playable = detail?.hydrated
      ? hydratedCollectionPlayableDuration(graph, details, node.id)
      : detail?.playableDuration;
    const playableDuration = playable === duration ? undefined : playable;
    advance(trackIndex, startTime + duration + CLIP_GAP_SECONDS);
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
      trackIndex,
      ...(placedStart === undefined ? {} : { placedStart }),
      ...(layerFrame === undefined ? {} : { layerFrame }),
      startTime,
      duration,
      sourceDuration: detail?.sourceDuration ?? duration,
      trimIn: detail?.trimIn ?? 0,
      trimOut: detail?.trimOut ?? 0,
      ...(node.disabled ? { disabled: true } : {}),
      ...tagsField(detail?.tags),
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
