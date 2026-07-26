import { getChildren, parseNodeId, type CollectionsGraph } from "@storyboard/collections-core";
import {
  graphChildrenToClips,
  type DetailsById,
  type PlaybackManifest,
} from "@storyboard/timeline-domain";
import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "@storyboard/timeline-model/constants";
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

/**
 * The cached manifest must not survive a preview disable — `useManifestClips`
 * calls this whenever `enabled` flips. The commit-driven discard effect in
 * graph-preview.tsx (which clears the cache the instant a change lands and
 * schedules a refetch) only runs while `enabled` is true, so a graph edit
 * made while preview is CLOSED leaves the pre-edit manifest cached with
 * nothing to clear it. Re-enabling would otherwise immediately return that
 * stale manifest (its `forId` still matches) until a fresh fetch installs —
 * which can fail (`!response.ok`) or sit behind the install guard
 * (`manifestTrailsLedger`) for a while. Dropping the cache here on every
 * disable means re-enabling always starts from the live projection and
 * refetches fresh, never showing an earlier graph generation.
 */
export function nextManifestClipsState<T>(state: T | null, enabled: boolean): T | null {
  return enabled ? state : null;
}

/**
 * How many consecutive failed manifest fetches to retry before giving up and
 * letting the projection fallback stand silently. A transient 500 or network
 * blip recovers within a couple of polls; a hard-down endpoint must not poll
 * forever on an idle session.
 */
export const MAX_MANIFEST_FETCH_RETRIES = 5;

/**
 * The retry streak must not survive a preview disable — `useManifestClips`
 * calls this whenever `enabled` flips, alongside dropping the cached manifest.
 * The failure count caps retries WITHIN one open session; once a hard-down
 * endpoint reaches the cap the count stays past it until a good response or a
 * different `focusedId`. Closing and reopening preview for the same timeline
 * only clears the cache, so a reopened session inherited the capped count and
 * the first failed fetch after reopening scheduled no retry — the projection
 * fallback then stood indefinitely. Zeroing on disable resets the streak so
 * every reopen starts a fresh session (re-enabling keeps 0, since disabling
 * already cleared it), exactly mirroring `nextManifestClipsState`.
 */
export function nextManifestFailureCount(count: number, enabled: boolean): number {
  return enabled ? count : 0;
}

/**
 * Whether a failed manifest fetch should schedule another attempt, given how
 * many consecutive failures have now accrued (the current one included). The
 * caller resets its streak to 0 on any good response and passes the
 * post-increment count here, so retries run for failures 1..`maxRetries` and
 * stop once the cap is exceeded.
 *
 * Aborts are NOT failures and must be filtered by the caller BEFORE this — an
 * aborted fetch (unmount/refocus/refetch) never counts and never retries.
 */
export function shouldRetryManifestFetch(
  consecutiveFailures: number,
  maxRetries: number = MAX_MANIFEST_FETCH_RETRIES,
): boolean {
  return consecutiveFailures > 0 && consecutiveFailures <= maxRetries;
}

export type ChildSpan = Readonly<{
  startTime: number;
  endTime: number;
  width: number;
  /** Won't play — the seek rail dims this stretch and the player jumps it.
   *  True for a clip disabled outright AND for one whose collection ancestor
   *  is (see `isDisabledByAncestor`); the rail draws no distinction, because
   *  either way nothing here reaches the viewer. */
  disabled?: boolean;
}>;

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
/**
 * Whether any COLLECTION above this node is disabled — the inherited state.
 * Disabling a collection disables everything inside it, at any depth, and a
 * descendant cannot opt back in.
 *
 * The node's own flag is deliberately NOT consulted: callers need to tell "off
 * because I said so" from "off because my parent is", and they show different
 * chips. Ask this and the node's own `disabled` separately.
 *
 * Cycle-guarded with a seen set — `parentById` is a tree in practice, but this
 * runs on the render path and a malformed graph must not hang it.
 */
export function isDisabledByAncestor(graph: CollectionsGraph, nodeId: string): boolean {
  const seen = new Set<string>();
  let parent = graph.parentById.get(nodeId as never) ?? null;
  while (parent !== null && !seen.has(parent as string)) {
    if (graph.nodesById.get(parent)?.disabled === true) return true;
    seen.add(parent as string);
    parent = graph.parentById.get(parent) ?? null;
  }
  return false;
}

export function childSpans(
  graph: CollectionsGraph,
  details: DetailsById,
  collectionId: string,
  spans: PreviewCardSpans | null,
  widthForClip: (clip: TimelineClip) => number,
): ChildSpan[] {
  const childIds = getChildren(graph, parseNodeId(collectionId));
  // Drilled INTO a disabled collection: none of these children carry the flag
  // themselves, but nothing here plays, so every card counts as disabled for
  // the rail. Resolved once for the whole level — it cannot vary between
  // siblings.
  const focusDisabled =
    graph.nodesById.get(parseNodeId(collectionId))?.disabled === true ||
    isDisabledByAncestor(graph, collectionId);
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
    return {
      width: widthForClip(clip),
      startTime,
      endTime,
      ...(focusDisabled || clip.disabled === true ? { disabled: true } : {}),
    };
  });
}

/**
 * Seconds of these cards that will actually PLAY — the readout number, as
 * opposed to the layout span the playhead sweeps.
 *
 * The two are the same until something is disabled, and this reduces to the
 * old `last.endTime` exactly when nothing is: leading padding, plus each
 * enabled card's own length, plus one gap between neighbours. Disabled cards
 * contribute neither their span nor a gap, which is what keeps the header
 * total describing what a viewer would sit through rather than how far the
 * playhead can travel.
 *
 * Card lengths come from `childSpans`, so a collection contributes the
 * manifest's full-depth window rather than a stored summary guess.
 */
/**
 * Content-space x ranges of the cards that will NOT play, in the strip's own
 * layout (widths plus the inter-card gutter — the same accumulation
 * `buildPlayheadMap` walks, so a segment lands exactly under its card).
 *
 * Shared by the strip's seek rail and the ruler band so the two mark the same
 * stretches; a disabled item reads as one continuous dimmed run across both.
 */
export function disabledCardSegments(
  cards: readonly ChildSpan[],
): Array<Readonly<{ x: number; width: number }>> {
  const segments: Array<Readonly<{ x: number; width: number }>> = [];
  let cursor = 0;
  for (const card of cards) {
    if (card.disabled === true) segments.push({ x: cursor, width: card.width });
    cursor += card.width + STRIP_GAP_PX;
  }
  return segments;
}

export function playableSpanSeconds(cards: readonly ChildSpan[]): number {
  const enabled = cards.filter((card) => card.disabled !== true);
  if (enabled.length === 0) return 0;
  const content = enabled.reduce((total, card) => total + (card.endTime - card.startTime), 0);
  return (
    TIMELINE_LEADING_PADDING_SECONDS + content + CLIP_GAP_SECONDS * (enabled.length - 1)
  );
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

// ── Ruler ticks ─────────────────────────────────────────────────────────────

const RULER_LABEL_MIN_GAP_PX = 46;
const RULER_MINOR_MIN_GAP_PX = 6;
const RULER_NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_MAX_SUBTIER = 3;

/** The labeled (major) tick interval — the nicest whole-second count whose
 *  on-screen gap clears the label minimum at this zoom. */
export function rulerMajorSpacing(pixelsPerSecond: number): number {
  const target = RULER_LABEL_MIN_GAP_PX / Math.max(1, pixelsPerSecond);
  return (
    RULER_NICE_SECONDS.find((step) => step >= target) ??
    RULER_NICE_SECONDS[RULER_NICE_SECONDS.length - 1]
  );
}

/** How many binary subdivisions of the major fit as MINOR ticks — major/2,
 *  /4, /8 (half, quarter, eighth of the major; at a 1s major these are the
 *  half/quarter/eighth SECOND ticks). Each tier is added only while its gap
 *  still clears the minor minimum, so zooming out drops the finest tiers. */
export function rulerSubtierCount(majorSpacing: number, pixelsPerSecond: number): number {
  let tiers = 0;
  while (
    tiers < RULER_MAX_SUBTIER &&
    (majorSpacing / 2 ** (tiers + 1)) * pixelsPerSecond >= RULER_MINOR_MIN_GAP_PX
  ) {
    tiers += 1;
  }
  return tiers;
}

/** The tier a tick at finest-step index `n` belongs to: the COARSEST whose
 *  spacing divides it (more trailing power-of-two factors = coarser tier).
 *  0 is the labeled major. */
export function rulerTickLevel(index: number, maxTier: number): number {
  if (index === 0) return 0;
  let trailing = 0;
  let value = index;
  while (trailing < maxTier && value % 2 === 0) {
    value /= 2;
    trailing += 1;
  }
  return maxTier - trailing;
}

export function formatRulerTick(seconds: number): string {
  if (seconds < 60) return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export type RulerTick = Readonly<{ x: number; level: number; label: string }>;

/** The content-x range ticks should exist for (overscan already applied by
 *  the caller). The ruler is NOT windowed by CSS clipping — ticks outside
 *  this range are simply never built, which is the whole point. */
export type RulerWindow = Readonly<{ startX: number; endX: number }>;

/**
 * The ruler's ticks for one strip, WINDOWED to a content-x range.
 *
 * Unwindowed, tick count scales with total DURATION at the finest tier —
 * a long timeline at high zoom is thousands of ticks, each an absolutely
 * positioned element, rebuilt per commit, almost all outside the viewport.
 * Ticks are indexed on a regular time grid, and `timeAt` (the map's inverse,
 * monotonic because card x-edges strictly increase) turns the window's pixel
 * bounds into a tick-INDEX range — so generation itself is O(visible), not
 * O(duration) merely filtered.
 *
 * Two exactness notes, both pinned by tests:
 * - A window whose `startX` reaches the content origin keeps the whole
 *   pre-content tick pile (every t at or before the first card's startTime
 *   clamps to x = 0 — the "0s" origin label lives there): `timeAt(0)` returns
 *   the first card's start TIME, and flooring from there would drop them.
 * - The index range is widened by the floor/ceil to one tick of slack per
 *   side, so a window never loses an edge tick to interpolation rounding —
 *   for any window, the output equals the full build filtered to it (± that
 *   slack), never less.
 *
 * Media cards are ruled; a collection card's fixed width holds an arbitrary
 * duration, so its INTERIOR is skipped (a smear of ticks says nothing) and a
 * single minor edge tick brackets it instead. The interior test binary-
 * searches the (sorted, disjoint) card ranges — with thousands of cards the
 * old linear `some` per tick was the other hidden O(n) in here.
 */
export function buildRulerTicks(
  cards: readonly ChildSpan[],
  isCollectionCard: readonly boolean[],
  pixelsPerSecond: number,
  windowRange: RulerWindow,
): RulerTick[] {
  if (cards.length === 0) return [];
  const map = buildPlayheadMap(cards);
  const total = map.totalDurationSeconds;
  if (total <= 0) return [];

  // Card x-ranges + collection flag, in the SAME cumulative layout the map
  // walks — one pass carrying the running left edge.
  const ranges: Array<{ x0: number; x1: number; isCollection: boolean }> = [];
  let cursorX = 0;
  for (let index = 0; index < cards.length; index += 1) {
    ranges.push({
      x0: cursorX,
      x1: cursorX + cards[index].width,
      isCollection: isCollectionCard[index] === true,
    });
    cursorX += cards[index].width + STRIP_GAP_PX;
  }

  // Ranges are sorted and disjoint (widths are positive, the gap separates
  // them), so at most ONE range can contain a given x: the last whose left
  // edge lies before it. Binary search for that candidate, then apply the
  // exact interior predicate to it alone.
  const inCollectionInterior = (cx: number): boolean => {
    if (ranges[0].x0 >= cx) return false;
    let low = 0;
    let high = ranges.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (ranges[middle].x0 < cx) low = middle;
      else high = middle - 1;
    }
    const range = ranges[low];
    return range.isCollection && cx > range.x0 + 1 && cx <= range.x1;
  };

  // Tiered ticks: a labeled MAJOR every `major` seconds, plus half / quarter
  // / eighth minors between them — as many tiers as clear the minor gap at
  // this zoom. Stepping by the FINEST spacing and assigning each step its
  // coarsest tier keeps every tier aligned to the major grid; the step index
  // is ABSOLUTE (n = t / finest), so windowing never shifts a tick's tier.
  const major = rulerMajorSpacing(pixelsPerSecond);
  const maxTier = rulerSubtierCount(major, pixelsPerSecond);
  const finest = major / 2 ** maxTier;
  const steps = Math.floor((total + 1e-6) / finest);
  const firstStep =
    windowRange.startX <= 0
      ? 0
      : Math.max(0, Math.floor(map.timeAt(windowRange.startX) / finest));
  const lastStep = Math.min(steps, Math.ceil(map.timeAt(windowRange.endX) / finest));

  const out: RulerTick[] = [];
  for (let n = firstStep; n <= lastStep; n += 1) {
    const t = n * finest;
    const cx = map.xAt(t);
    if (inCollectionInterior(cx)) continue;
    const level = rulerTickLevel(n, maxTier);
    out.push({
      x: cx,
      level,
      label: level === 0 ? formatRulerTick(Math.round(t * 1000) / 1000) : "",
    });
  }
  // A minor edge tick bracketing each collection's blank interior — windowed
  // like every other tick.
  for (const range of ranges) {
    if (range.isCollection && range.x0 >= windowRange.startX && range.x0 <= windowRange.endX) {
      out.push({ x: range.x0, level: 1, label: "" });
    }
  }
  return out;
}

export type RulerCollectionSpan = Readonly<{ x: number; width: number; seconds: number }>;

/**
 * Each collection card's x-range and content duration, for the ruler band to
 * FILL with a duration label (R7 #4): `buildRulerTicks` deliberately skips a
 * collection's interior (its fixed width holds an arbitrary duration, so
 * ticks there would lie), which left the same opaque band as media cards
 * with nothing in it — reading as a rendering gap rather than a decision.
 * Windowed like the ticks: only spans INTERSECTING the visible range exist.
 * Same cumulative layout walk as the tick ranges, so the two can never
 * disagree about where a collection sits.
 */
export function buildRulerCollectionSpans(
  cards: readonly ChildSpan[],
  isCollectionCard: readonly boolean[],
  windowRange: RulerWindow,
): RulerCollectionSpan[] {
  const out: RulerCollectionSpan[] = [];
  let cursorX = 0;
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const x1 = cursorX + card.width;
    if (
      isCollectionCard[index] === true &&
      x1 >= windowRange.startX &&
      cursorX <= windowRange.endX
    ) {
      out.push({ x: cursorX, width: card.width, seconds: card.endTime - card.startTime });
    }
    cursorX = x1 + STRIP_GAP_PX;
  }
  return out;
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
