// The playback read model: a timeline's COMPLETE nested document closure
// flattened into absolute-time media leaves — what a full-depth preview
// plays. Compiled from STORED documents (typically server-side, where the
// closure is cheap to load), so playback depth no longer depends on how
// much of the graph a session happens to have hydrated, and duplicated
// clip ids across documents are a non-issue: leaves key on their
// collection path, nothing enters the graph.
//
// The window math handles nested collection clips that are TRIMMED or
// time-scaled in their parent: each recursion narrows the child's local
// time window (trimIn + displayed progress across the source range) and
// maps it onto the parent's output span, accumulating `playbackRate` so a
// leaf knows both WHERE it plays (timelineStart/Duration in root time) and
// WHAT it plays (sourceStart, advancing at playbackRate).
//
// DISABLED clips are compiled in, marked rather than dropped, so this clock
// matches the board's layout exactly. Skipping them is the player's job —
// only it knows whether the user is playing (jump the span) or scrubbing
// (draw it grayed).

import { trackIndexOf } from "@storyboard/timeline-model/documents";
import { layerFrameOf, type LayerFrame } from "@storyboard/timeline-model/layer-frame";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

export type PlaybackLeaf = Readonly<{
  id: string;
  collectionPath: readonly string[];
  kind: "image" | "video" | "audio";
  src: string;
  /** Never present on an audio leaf — audio has no frames to poster. */
  poster?: string;
  timelineStart: number;
  timelineDuration: number;
  sourceStart: number;
  playbackRate: number;
  /**
   * Which lane this plays in, relative to the ROOT timeline: 0 is the picture,
   * anything higher runs under it.
   *
   * THE OUTERMOST NON-ZERO LANE ON THE PATH, not the leaf's own. Where a thing
   * sits relative to the root is what decides whether it is picture or
   * under-layer; a lane inside a collection only governs that collection's own
   * layout, which the window math has already resolved by the time a leaf
   * exists.
   *
   * So a bed on lane 1 inside a lane-0 scene is lane 1 — it runs under. And
   * every leaf inside a lane-1 collection is lane 1, however its own children
   * are arranged, because the whole collection was placed under the picture.
   *
   * Absent is impossible; 0 is the answer for everything written before lanes.
   */
  trackIndex: number;
  /**
   * Where this draws inside the picture, normalized 0..1 of the output frame.
   * Absent means it contributes SOUND ONLY, which is what every layer did
   * before compositing existed.
   *
   * The leaf's OWN frame, unlike `trackIndex` above, which takes the outermost
   * lane on the path. Lane answers "is this picture or under-layer", and a
   * collection above can settle that for everything beneath it. A rectangle
   * cannot be settled that way: a frame on the collection would describe where
   * the SCENE sits, and there is no defined composition of the two — so an
   * inset inside a layered collection is not inherited, it is its own.
   */
  layerFrame?: Readonly<{ x: number; y: number; width: number }>;
  /**
   * The clip's own shape, so an inset drawn from `layerFrame` is never
   * stretched.
   *
   * Optional only for payloads written before it existed — everything the
   * compiler emits has one. Absent means widescreen, which is what
   * `manifestToClips` assumed for EVERY leaf before this: the preview shaped
   * every inset 16:9 no matter what the clip was, and the export would have
   * disagreed with it the moment a portrait clip went on a lane.
   */
  aspect?: number;
  /** Skipped by the PLAYER, not by this compiler. A disabled leaf keeps its
   *  full span on the timeline — that span is what the playhead jumps over
   *  while playing and what a scrub can land inside. Set when the leaf's own
   *  clip is disabled OR any collection clip above it on the path was.
   *  Absent means playable. */
  disabled?: boolean;
}>;

export type PlaybackManifest = Readonly<{
  projectId: string;
  projectRevision: number;
  durationSeconds: number;
  leaves: readonly PlaybackLeaf[];
  compiledAt: string;
  /** Save revision of EVERY document the compile read, keyed by id. The
   *  client's install guard compares each against its own write ledger:
   *  `projectRevision` alone could only catch a stale ROOT, so a manifest
   *  compiled before a CHILD edit landed installed fine and stuck — playing
   *  pre-edit content until the next unrelated commit. Optional so
   *  hand-built fixtures and older payloads keep working (absent = only the
   *  root check applies). */
  documentRevisions?: Readonly<Record<string, number>>;
}>;

type DocumentMap = Readonly<Record<string, TimelineDocument>>;

type TimeWindow = Readonly<{
  localStart: number;
  localEnd: number;
  outputStart: number;
  outputDuration: number;
}>;

/** The leaf's frame, defended through the model's own normalizer so a stored
 *  rectangle that is not one compiles to "sound only" rather than to an inset
 *  in an undefined place. */
function frameField(clip: TimelineClip): Readonly<{ layerFrame?: LayerFrame }> {
  const frame = layerFrameOf(clip.layerFrame);
  return frame === undefined ? {} : { layerFrame: frame };
}

function documentDuration(document: TimelineDocument): number {
  return document.clips.reduce(
    (duration, clip) => Math.max(duration, clip.startTime + clip.duration),
    0,
  );
}

function addMediaLeaf(
  leaves: PlaybackLeaf[],
  clip: Exclude<TimelineClip, { kind: "collection" }>,
  path: readonly string[],
  window: TimeWindow,
  overlapStart: number,
  overlapEnd: number,
  disabled: boolean,
  trackIndex: number,
): void {
  const localSpan = Math.max(0.001, window.localEnd - window.localStart);
  const outputScale = window.outputDuration / localSpan;
  const sourceRange = Math.max(0.001, clip.sourceDuration - clip.trimIn - clip.trimOut);
  const clipProgress = clip.duration > 0 ? (overlapStart - clip.startTime) / clip.duration : 0;

  leaves.push({
    id: clip.id,
    collectionPath: path,
    kind: clip.kind,
    src: clip.src,
    ...(clip.poster === undefined ? {} : { poster: clip.poster }),
    timelineStart: window.outputStart + (overlapStart - window.localStart) * outputScale,
    timelineDuration: (overlapEnd - overlapStart) * outputScale,
    sourceStart: clip.trimIn + clipProgress * sourceRange,
    playbackRate: (sourceRange / Math.max(0.001, clip.duration)) / outputScale,
    trackIndex,
    aspect: clip.aspect > 0 ? clip.aspect : 16 / 9,
    // Only where it actually runs under the picture. A frame left behind on a
    // clip that has since been moved back onto the cut is stale authoring, not
    // an instruction — and lane 0 has nothing to be inset within.
    ...(trackIndex === 0 ? {} : frameField(clip)),
    ...(disabled ? { disabled: true } : {}),
  });
}

function flattenDocument(
  documents: DocumentMap,
  documentId: string,
  path: readonly string[],
  window: TimeWindow,
  visited: ReadonlySet<string>,
  leaves: PlaybackLeaf[],
  /** True once any collection clip ABOVE this document was disabled. Disabling
   *  a collection disables everything under it, and there is no way back on
   *  the way down — an enabled child of a disabled parent still does not play.
   */
  inheritedDisabled: boolean,
  /** The outermost non-zero lane seen on the way down, or 0 while still on the
   *  picture. Once a collection has put us under the picture, everything below
   *  it is under there too — there is no way back up, the same shape
   *  `inheritedDisabled` has. */
  laneFromRoot: number,
): void {
  if (visited.has(documentId)) throw new Error(`Collection cycle detected at "${documentId}".`);
  const document = documents[documentId];
  if (!document) throw new Error(`Missing nested timeline "${documentId}".`);

  const nextVisited = new Set(visited);
  nextVisited.add(documentId);

  for (const clip of document.clips) {
    const clipEnd = clip.startTime + clip.duration;
    const overlapStart = Math.max(clip.startTime, window.localStart);
    const overlapEnd = Math.min(clipEnd, window.localEnd);
    if (overlapEnd <= overlapStart) continue;

    // Disabled rides DOWN the walk instead of pruning it: the subtree still
    // compiles, so a disabled collection keeps its span and every leaf under
    // it is marked. That span is what the player jumps over and what a scrub
    // can land inside.
    const clipDisabled = inheritedDisabled || clip.disabled === true;
    // The OUTERMOST non-zero lane wins: once something above put us under the
    // picture, a lane index down here only described that collection's own
    // internal layout, which the window math has already resolved.
    const clipLane = laneFromRoot !== 0 ? laneFromRoot : trackIndexOf(clip);

    if (clip.kind !== "collection") {
      addMediaLeaf(leaves, clip, path, window, overlapStart, overlapEnd, clipDisabled, clipLane);
      continue;
    }

    const sourceRange = Math.max(0.001, clip.sourceDuration - clip.trimIn - clip.trimOut);
    const displayedStartProgress =
      clip.duration > 0 ? (overlapStart - clip.startTime) / clip.duration : 0;
    const displayedEndProgress =
      clip.duration > 0 ? (overlapEnd - clip.startTime) / clip.duration : 1;
    const childStart = clip.trimIn + displayedStartProgress * sourceRange;
    const childEnd = clip.trimIn + displayedEndProgress * sourceRange;
    const parentScale =
      window.outputDuration / Math.max(0.001, window.localEnd - window.localStart);

    flattenDocument(
      documents,
      clip.childTimelineId,
      [...path, clip.childTimelineId],
      {
        localStart: childStart,
        localEnd: childEnd,
        outputStart: window.outputStart + (overlapStart - window.localStart) * parentScale,
        outputDuration: (overlapEnd - overlapStart) * parentScale,
      },
      nextVisited,
      leaves,
      clipDisabled,
      clipLane,
    );
  }
}

export function compilePlaybackManifest(
  documents: DocumentMap,
  projectId: string,
  projectRevision: number,
  compiledAt: string,
  documentRevisions?: Readonly<Record<string, number>>,
): PlaybackManifest {
  if (!documents[projectId]) throw new Error(`Unknown project timeline "${projectId}".`);
  // Compiled from the STORED closure, disabled clips and all. They keep their
  // stored positions, so the manifest's clock IS the board's layout: the
  // playhead maps onto the same cards, a disabled item has a real span to be
  // jumped over, and a scrub can come to rest inside one.
  //
  // This is the inverse of the original design, which dropped disabled clips
  // and repacked the survivors here. That closed the gap (necessary, because
  // the player HOLDS the last frame across an empty span — a freeze-frame,
  // not a skip) but left nothing to jump over or scrub into. The skip now
  // happens in the player instead, which can tell playing from scrubbing;
  // this compiler cannot.
  const root = documents[projectId];
  const durationSeconds = documentDuration(root);
  const leaves: PlaybackLeaf[] = [];

  flattenDocument(
    documents,
    projectId,
    [projectId],
    {
      localStart: 0,
      localEnd: Math.max(0.001, durationSeconds),
      outputStart: 0,
      outputDuration: durationSeconds,
    },
    new Set(),
    leaves,
    false,
    // The root IS the picture. Everything descends from lane 0 until some clip
    // on the way down says otherwise.
    0,
  );

  return {
    projectId,
    projectRevision,
    durationSeconds,
    leaves: leaves.sort((a, b) => a.timelineStart - b.timelineStart),
    compiledAt,
    ...(documentRevisions === undefined ? {} : { documentRevisions }),
  };
}

/**
 * Manifest leaves as synthetic TimelineClips for the workbench player. The
 * player resolves a video's source time as
 * `trimIn + progress * (sourceDuration - trimIn - trimOut)`, so a leaf maps
 * losslessly: trimIn = sourceStart, trimOut = 0, and sourceDuration set so
 * the remaining range spans exactly `timelineDuration * playbackRate`. Leaf
 * ids can repeat across documents (duplicated references), so the clip id
 * is path-qualified.
 */
export function manifestToClips(manifest: PlaybackManifest): TimelineClip[] {
  return manifest.leaves.map((leaf, index) => {
    const sourceRange = Math.max(0.001, leaf.timelineDuration * leaf.playbackRate);
    const base = {
      id: `${leaf.collectionPath.join("/")}:${leaf.id}`,
      index,
      alt: leaf.id,
      // The leaf's REAL shape. Hardcoded 16/9 here previously, which made
      // every inset widescreen in the preview whatever the clip was.
      aspect: leaf.aspect !== undefined && leaf.aspect > 0 ? leaf.aspect : 16 / 9,
      // The leaf's REAL lane, so the player lays simultaneous leaves out the
      // way the board does rather than stacking them all on the picture.
      trackIndex: leaf.trackIndex,
      startTime: leaf.timelineStart,
      duration: leaf.timelineDuration,
      sourceDuration: leaf.sourceStart + sourceRange,
      trimIn: leaf.sourceStart,
      trimOut: 0,
      // The player reads this to decide whether to skip the span (playing) or
      // draw it grayed (scrubbing).
      ...(leaf.disabled ? { disabled: true } : {}),
    };
    if (leaf.kind === "video") {
      return {
        ...base,
        kind: "video",
        src: leaf.src,
        ...(leaf.poster === undefined ? {} : { poster: leaf.poster }),
      };
    }
    if (leaf.kind === "audio") {
      // No poster, deliberately: a poster minted for an audio asset is a
      // broken image URL, and the model forbids one.
      return { ...base, kind: "audio", src: leaf.src };
    }
    return {
      ...base,
      kind: "image",
      src: leaf.src,
      ...(leaf.poster === undefined ? {} : { poster: leaf.poster }),
    };
  });
}
