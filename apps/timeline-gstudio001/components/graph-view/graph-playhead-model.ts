import { getChildren, parseNodeId, type CollectionsGraph } from "@storyboard/collections-core";
import {
  graphChildrenToClips,
  type DetailsById,
  type PlaybackManifest,
} from "@storyboard/timeline-domain";
import type { TimelineClip } from "@storyboard/timeline-model/types";

import { GRID_GAP } from "./graph-view-config";

// The PURE playhead read model — how a channel time becomes an x (or cell
// position) on a strip or grid, and how the server manifest's leaves become
// per-card time windows. No React, no DOM: graph-preview.tsx renders these
// maps; this module only computes them, so the clock math is unit-testable
// where the component shell is not (the app's vitest cannot parse .tsx).

/** Gap between cards in the strip layout — must match the strip's gutter. */
export const STRIP_GAP_PX = 8;

/**
 * The global-clock window of every node the manifest touches, keyed by node
 * id — each media leaf by its own id, AND every collection on a leaf's path
 * by the union of the leaves beneath it.
 *
 * This is what lets ONE clock drive a playhead on every row of the tree, not
 * just the focused strip: a sub-timeline row for collection C looks up C's
 * children here (media by id, nested collections by their aggregated window)
 * and maps the same channel time onto its own layout.
 */
export type PreviewCardSpans = ReadonlyMap<string, Readonly<{ start: number; end: number }>>;

/**
 * A media leaf's span key, qualified by its parent collection. Leaf ids can
 * repeat across documents (one clip referenced from two collections), and a
 * flat id key MERGED both occurrences into one span covering both — so the
 * card in either row mapped time across the union window. The length prefix
 * makes the key unambiguous for ANY id contents: a NodeId may contain any
 * non-whitespace character, including a would-be delimiter.
 *
 * Collections stay bare-id keyed — the graph demotes duplicate collection
 * references, so a collection id names exactly one node.
 */
export function mediaSpanKey(parentId: string, leafId: string): string {
  return `${parentId.length}#${parentId}${leafId}`;
}

export function cardSpansOf(manifest: PlaybackManifest): PreviewCardSpans {
  const spans = new Map<string, { start: number; end: number }>();
  const widen = (key: string, start: number, end: number) => {
    const current = spans.get(key);
    spans.set(
      key,
      current
        ? { start: Math.min(current.start, start), end: Math.max(current.end, end) }
        : { start, end },
    );
  };
  for (const leaf of manifest.leaves) {
    const end = leaf.timelineStart + leaf.timelineDuration;
    const parentId = leaf.collectionPath[leaf.collectionPath.length - 1] ?? "";
    widen(mediaSpanKey(parentId, leaf.id), leaf.timelineStart, end);
    // Every collection ANCESTOR on the path gets this leaf folded into its
    // window (collectionPath[0] is the focused root; deeper entries are the
    // nested collections whose sub-rows need their own window).
    for (const collectionId of leaf.collectionPath) widen(collectionId, leaf.timelineStart, end);
  }
  return spans;
}

/**
 * Whether a fetched manifest is STALE against this session's own writes — it
 * was compiled from a document version older than one the session has already
 * saved. Installing it would play pre-edit content and, because refetches are
 * commit-driven, it would STICK until the next unrelated edit.
 *
 * Checks every document the compile read (`documentRevisions`), not just the
 * root: a child edit bumps only the CHILD's revision, so the root check alone
 * let a pre-edit compile through. Manifests without the field (hand-built
 * fixtures, older servers) fall back to the root-only check.
 *
 * The revision comparison alone still loses one race: a write UNSETTLED when
 * the compile ran (debounced, or batch response not yet landed) hasn't bumped
 * the ledger, so a pre-write compile passes `revisionOf` and installs anyway.
 * `hasPendingWrite` closes it — any document in the read set with an
 * unsettled write makes the manifest untrusted, and the caller's retry simply
 * waits the write out. Conservative on purpose: a compile that in fact read
 * post-write content is also deferred one cycle, which only delays install,
 * never wrongs it.
 */
export function manifestTrailsLedger(
  manifest: Pick<PlaybackManifest, "projectRevision" | "documentRevisions">,
  projectId: string,
  revisionOf: (id: string) => number | undefined,
  hasPendingWrite?: (id: string) => boolean,
): boolean {
  const revisions = manifest.documentRevisions;
  if (revisions !== undefined) {
    for (const [id, compiled] of Object.entries(revisions)) {
      if (hasPendingWrite?.(id)) return true;
      const ledger = revisionOf(id);
      if (ledger !== undefined && compiled < ledger) return true;
    }
  }
  if (hasPendingWrite?.(projectId)) return true;
  const rootLedger = revisionOf(projectId);
  return rootLedger !== undefined && manifest.projectRevision < rootLedger;
}

export type ChildSpan = Readonly<{ startTime: number; endTime: number; width: number }>;

/**
 * Each direct child of `collectionId`, with its time window in the clock the
 * pane is playing and the strip WIDTH the child is drawn at. The single source
 * both the strip and grid markers build from — and, because it is
 * parameterised on any collection id, the same thing a nested sub-row uses for
 * its own children.
 *
 * TIME comes from the manifest spans when present (the model the pane plays);
 * a child with no span (an empty collection contributes no playback) falls
 * back to its PROJECTION times — and because those speak a different clock
 * that can drift from the manifest's, every card is CLAMPED monotonic against
 * its predecessor. Without the clamp a span-less card between two manifest-
 * timed siblings produced an unsorted times array, and the map's binary
 * search silently returned garbage x positions.
 *
 * WIDTH is the caller's (`widthForClip`) — the strip's own layout, which the
 * pane has no say in. Injected rather than imported so this module needs
 * nothing from the React package and the tests can use trivial widths.
 *
 * Zips by INDEX against `getChildren` rather than clip id: a projection clip
 * reports `detail.sourceClipId` when one exists, which is not the node id the
 * manifest paths are built from, but `graphChildrenToClips` maps over the
 * same `getChildren` array, so index alignment holds.
 */
export function childSpans(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: string,
  spans: PreviewCardSpans | null,
  widthForClip: (clip: TimelineClip) => number,
): ChildSpan[] {
  const childIds = getChildren(graph, parseNodeId(collectionId));
  let previousEnd = 0;
  return graphChildrenToClips(graph, details, collectionId).map((clip, index) => {
    const childId = childIds[index] as string;
    // Media first (parent-qualified — see mediaSpanKey), then the bare id a
    // collection child is keyed under. A demoted duplicate's `dup:`-prefixed
    // node id matches neither and falls through to projection times, which
    // is the honest degradation for a card the manifest can't name.
    const span = spans?.get(mediaSpanKey(collectionId, childId)) ?? spans?.get(childId);
    const startTime = Math.max(span ? span.start : clip.startTime, previousEnd);
    const endTime = Math.max(span ? span.end : clip.startTime + clip.duration, startTime);
    previousEnd = endTime;
    return { width: widthForClip(clip), startTime, endTime };
  });
}

export type PlayheadMap = Readonly<{
  xAt: (time: number) => number;
  timeAt: (x: number) => number;
  totalDurationSeconds: number;
}>;

export function buildPlayheadMap(cards: readonly ChildSpan[]): PlayheadMap {
  const times: number[] = [];
  const xs: number[] = [];
  let x = 0;
  for (const card of cards) {
    times.push(card.startTime, card.endTime);
    xs.push(x, x + card.width);
    x += card.width + STRIP_GAP_PX;
  }
  const count = times.length;
  const total = count > 0 ? times[count - 1] : 0;

  const interpolate = (value: number, from: number[], to: number[]): number => {
    if (count === 0) return 0;
    if (value <= from[0]) return to[0];
    if (value >= from[count - 1]) return to[count - 1];
    let low = 0;
    let high = count - 1;
    while (low < high - 1) {
      const middle = (low + high) >> 1;
      if (from[middle] <= value) low = middle;
      else high = middle;
    }
    const span = from[high] - from[low];
    const fraction = span > 0 ? (value - from[low]) / span : 0;
    return to[low] + fraction * (to[high] - to[low]);
  };

  return {
    xAt: (time) => interpolate(time, times, xs),
    timeAt: (offset) => interpolate(offset, xs, times),
    totalDurationSeconds: total,
  };
}

export type GridPlayheadMap = Readonly<{
  posAt: (time: number) => { x: number; y: number };
  timeAt: (x: number, y: number) => number;
  totalDurationSeconds: number;
  rowHeight: number;
}>;

export function buildGridPlayheadMap(
  cells: readonly ChildSpan[],
  cols: number,
  cellWidth: number,
  cellHeight: number,
): GridPlayheadMap {
  const columns = Math.max(1, cols);
  const starts: number[] = [];
  const ends: number[] = [];
  for (const cell of cells) {
    starts.push(cell.startTime);
    ends.push(cell.endTime);
  }
  const count = cells.length;
  const total = count > 0 ? ends[count - 1] : 0;
  const cellX = (index: number) => (index % columns) * (cellWidth + GRID_GAP);
  const cellY = (index: number) => Math.floor(index / columns) * (cellHeight + GRID_GAP);
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  return {
    rowHeight: cellHeight,
    totalDurationSeconds: total,
    posAt: (time) => {
      if (count === 0) return { x: 0, y: 0 };
      let low = 0;
      if (time >= starts[count - 1]) {
        low = count - 1;
      } else if (time > starts[0]) {
        let high = count - 1;
        while (low < high - 1) {
          const middle = (low + high) >> 1;
          if (starts[middle] <= time) low = middle;
          else high = middle;
        }
      }
      const span = ends[low] - starts[low];
      const fraction = span > 0 ? clamp01((time - starts[low]) / span) : 0;
      return { x: cellX(low) + fraction * cellWidth, y: cellY(low) };
    },
    timeAt: (x, y) => {
      if (count === 0) return 0;
      const row = Math.max(0, Math.floor(y / (cellHeight + GRID_GAP)));
      const column = Math.max(0, Math.min(columns - 1, Math.floor(x / (cellWidth + GRID_GAP))));
      const index = Math.max(0, Math.min(count - 1, row * columns + column));
      const fraction = clamp01((x - cellX(index)) / cellWidth);
      return Math.min(
        total,
        Math.max(0, starts[index] + fraction * (ends[index] - starts[index])),
      );
    },
  };
}
