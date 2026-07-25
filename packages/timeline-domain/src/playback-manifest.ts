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

import { effectiveDocuments } from "@storyboard/timeline-model";
import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

export type PlaybackLeaf = Readonly<{
  id: string;
  collectionPath: readonly string[];
  kind: "image" | "video";
  src: string;
  poster?: string;
  timelineStart: number;
  timelineDuration: number;
  sourceStart: number;
  playbackRate: number;
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
  });
}

function flattenDocument(
  documents: DocumentMap,
  documentId: string,
  path: readonly string[],
  window: TimeWindow,
  visited: ReadonlySet<string>,
  leaves: PlaybackLeaf[],
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

    if (clip.kind !== "collection") {
      addMediaLeaf(leaves, clip, path, window, overlapStart, overlapEnd);
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
  // Compile from the EFFECTIVE closure: disabled clips dropped, survivors
  // repacked. Doing it here rather than inside `flattenDocument` is what
  // makes the window math below work unchanged — it maps a parent's output
  // span onto the child's LOCAL time range, so the child's coordinates have
  // to already be closed up. Filtering during the walk would instead leave
  // the disabled clip's span empty, and the player holds the last frame
  // across a gap: a freeze-frame, not a skip.
  //
  // Dropping a disabled COLLECTION clip removes its whole subtree here,
  // without walking into it.
  const effective = effectiveDocuments(documents);
  const root = effective[projectId];
  const durationSeconds = documentDuration(root);
  const leaves: PlaybackLeaf[] = [];

  flattenDocument(
    effective,
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
      aspect: 16 / 9,
      trackIndex: 0,
      startTime: leaf.timelineStart,
      duration: leaf.timelineDuration,
      sourceDuration: leaf.sourceStart + sourceRange,
      trimIn: leaf.sourceStart,
      trimOut: 0,
    };
    if (leaf.kind === "video") {
      return {
        ...base,
        kind: "video",
        src: leaf.src,
        ...(leaf.poster === undefined ? {} : { poster: leaf.poster }),
      };
    }
    return {
      ...base,
      kind: "image",
      src: leaf.src,
      ...(leaf.poster === undefined ? {} : { poster: leaf.poster }),
    };
  });
}
