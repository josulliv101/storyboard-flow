/**
 * The native-drop DECISIONS: hit-testing, anchor resolution, indicator
 * geometry and the status line — everything the two drop surfaces compute
 * before they touch the DOM or the store.
 *
 * A `.ts` module because the app's vitest cannot parse `.tsx`, so all of this
 * was untestable while it lived inside `graph-native-drop.tsx` (#281). That is
 * not academic here: the flat-run boundary bug in PL12-005 — where the
 * indicator pointed at one gap and the commit landed in another — was a defect
 * in exactly these functions, found by an e2e test after it shipped, because
 * nothing cheaper could reach them.
 *
 * Everything here is DATA IN, VALUE OUT. Measuring the page belongs to the
 * surface components; so does anything that draws.
 */

import type { NodeId } from "@storyboard/ui/dnd-collections";

/** The drag payload the sidebar tool travels as. */
export const TOOL_MIME = "application/x-gstudio-type";

// Collection is the only sidebar tool now: the old image/video tools minted
// demo-content placeholders nobody used — real media arrives as FILES (OS
// drop / picker), handled by the upload path.
export type SidebarTool = "collection";

export function isSidebarTool(value: string): value is SidebarTool {
  return value === "collection";
}

/** Human label for an inserted tool, for the announcement. */
export const TOOL_LABELS: Readonly<Record<SidebarTool, string>> = {
  collection: "collection",
};

/** How many dropped files are decoded/uploaded at once. `Promise.all` over the
 *  whole drop meant N video decoders, canvases, blobs, and uploads existing
 *  simultaneously — dropping a folder of large videos produced a burst that
 *  stalled the main thread. Small enough to bound the peak, big enough that
 *  network latency still overlaps. */
export const MAX_CONCURRENT_MEDIA = 3;

/** Default timeline seconds for a dropped image. */
export const IMAGE_CLIP_SECONDS = 4;

/** Client-space geometry of one mounted card, measured once per drag. */
export type CardGeometry = Readonly<{
  nodeId: string;
  left: number;
  right: number;
  mid: number;
}>;

/** Client-space geometry of one mounted GRID cell, measured once per drag. */
export type GridCellGeometry = Readonly<{
  nodeId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  midX: number;
}>;

/** Where the grid indicator draws — a vertical bar at the resolved boundary. */
export type GridIndicator = Readonly<{ x: number; y: number; height: number }>;

/**
 * A drop position expressed by its NEIGHBOURS rather than by a number.
 *
 * A file drop does not commit until its uploads finish, and the graph is
 * fully editable during that window — a bare index captured at drop time
 * silently comes to mean a different boundary. The neighbouring ids still
 * name the same gap after the rest of the strip moves around them.
 */
export type DropAnchor = Readonly<{
  /** Child immediately before the gap at drop time, if any. */
  beforeId: string | null;
  /** Child immediately after it, if any. */
  afterId: string | null;
  /** Index at drop time — the last-resort fallback if neither survives. */
  index: number;
}>;

export function acceptsDragTypes(types: readonly string[] | undefined): boolean {
  if (!types) return false;
  return types.includes(TOOL_MIME) || types.includes("Files");
}

/**
 * Index of the child whose id equals `nodeId`. Matches by VALUE rather than
 * reconstructing a `NodeId` — an id may be any non-whitespace string, and
 * `NodeId` is structurally a string, so no cast is needed either side of the
 * comparison.
 */
export function indexOfChildId(children: readonly NodeId[], nodeId: string): number {
  return children.findIndex((childId) => childId === nodeId);
}

/** The `DropAnchor` neighbour ids that bracket `index` within `children`. */
export function neighborsAt(
  children: readonly NodeId[],
  index: number,
): Pick<DropAnchor, "beforeId" | "afterId"> {
  // `?? null` rather than a cast: an index at either edge legitimately has no
  // neighbour, which is exactly what the null already means to DropAnchor.
  return {
    beforeId: (index > 0 ? children[index - 1] : null) ?? null,
    afterId: (index < children.length ? children[index] : null) ?? null,
  };
}

/** One live drop's contribution to the status line. */
export type DropStatus =
  | Readonly<{ status: "uploading"; count: number }>
  /** `at` drives expiry — see ERROR_LINGER_MS. */
  | Readonly<{ status: "error"; message: string; at: number }>;

/** How long a failure stays on screen. An error with no expiry outlived its
 *  drop forever: the banner never went away and, because errors used to beat
 *  progress outright, every later upload was invisible behind it. */
export const ERROR_LINGER_MS = 8000;

/** What the strip actually renders — composed in ONE place. */
export type DropSummary = Readonly<{ tone: "progress" | "error"; message: string }>;

/**
 * Collapse every live drop into the single status line.
 *
 * Progress and failures are shown TOGETHER rather than one winning: several
 * drops can be live at once, so "errors win" hid active uploads behind a
 * stale failure, while "latest wins" hid failures behind a later success.
 * Counts sum, so "3 files" means three.
 */
export function aggregateDropStatus(
  drops: ReadonlyMap<number, DropStatus>,
): DropSummary | null {
  const messages: string[] = [];
  let uploading = 0;
  for (const entry of drops.values()) {
    if (entry.status === "error") messages.push(entry.message);
    else uploading += entry.count;
  }
  const parts: string[] = [];
  if (uploading > 0) parts.push(`Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`);
  parts.push(...new Set(messages));
  if (parts.length === 0) return null;
  return { tone: messages.length > 0 ? "error" : "progress", message: parts.join(" · ") };
}

/**
 * The STRIP's boundary index for a drop at `clientX`, via mounted-card
 * midpoints.
 *
 * `order` is whatever the strip IS SHOWING — this collection's children
 * normally, and the FLAT RUN in flat mode. It used to be children only, and in
 * a flat run that quietly broke twice over: the flat cards are mostly not
 * children, so the lookup returned -1 and the scan walked straight past the
 * card the pointer was actually before, stopping at whichever later card
 * happened to be a direct child — and the neighbour ids it recorded came from
 * the wrong list too. The indicator, being pure geometry, kept pointing at the
 * right gap the whole time, so the line the user saw and the index that
 * committed disagreed.
 *
 * `cards` is null when the drag never produced a measurement (a programmatic
 * drop with no preceding dragover), which appends.
 */
export function stripDropAnchor(
  input: Readonly<{
    order: readonly NodeId[];
    cards: readonly CardGeometry[] | null;
    clientX: number;
  }>,
): DropAnchor {
  const { order, cards, clientX } = input;
  let index = order.length;
  if (cards) {
    let resolved = -1;
    for (const card of cards) {
      if (clientX < card.mid) {
        const at = indexOfChildId(order, card.nodeId);
        if (at >= 0) {
          resolved = at;
          break;
        }
      }
    }
    if (resolved < 0) {
      const last = cards[cards.length - 1];
      const at = last ? indexOfChildId(order, last.nodeId) : -1;
      if (at >= 0) resolved = at + 1;
    }
    if (resolved >= 0) index = resolved;
  }
  return { index, ...neighborsAt(order, index) };
}

/**
 * Where the STRIP's indicator line sits, in wrapper-relative pixels.
 *
 * Snaps to the resolved insertion edge when a card anchors it, else follows the
 * pointer (empty strip / trailing whitespace). The ±3 is the visual gap between
 * the line and the card it marks.
 */
export function stripIndicatorX(
  input: Readonly<{
    cards: readonly CardGeometry[];
    wrapperLeft: number;
    clientX: number;
  }>,
): number {
  const { cards, wrapperLeft, clientX } = input;
  let x = clientX - wrapperLeft;
  for (const card of cards) {
    if (clientX < card.mid) {
      x = card.left - wrapperLeft - 3;
      break;
    }
    x = card.right - wrapperLeft + 3;
  }
  return x;
}

/**
 * The mounted GRID cell the insertion boundary sits BEFORE, or null to append.
 *
 * Reading order: a cell FOLLOWS the pointer if it starts on a row below the
 * pointer, or shares the pointer's row and lies to its right.
 */
export function cellFollowingPointer(
  cells: readonly GridCellGeometry[],
  x: number,
  y: number,
): GridCellGeometry | null {
  for (const cell of cells) {
    const rowBelow = y < cell.top;
    const sameRow = y >= cell.top && y <= cell.bottom;
    const follows = rowBelow || (sameRow && x < cell.midX);
    if (follows) return cell;
  }
  return null;
}

/**
 * The GRID's drop anchor. Indexes come from the GRAPH, matched to mounted
 * cells by id — exactly as the strip does — so virtualization cannot make the
 * DOM position stand in for a child index.
 */
export function gridDropAnchor(
  input: Readonly<{
    children: readonly NodeId[];
    cells: readonly GridCellGeometry[] | null;
    clientX: number;
    clientY: number;
  }>,
): DropAnchor {
  const { children, cells, clientX, clientY } = input;
  let index = children.length;
  if (cells) {
    const before = cellFollowingPointer(cells, clientX, clientY);
    if (before) {
      const at = indexOfChildId(children, before.nodeId);
      if (at >= 0) index = at;
    }
  }
  return { index, ...neighborsAt(children, index) };
}

/**
 * Where the GRID's indicator bar draws, in wrapper-relative pixels — at the
 * CENTER of the visual gap the resolved boundary represents.
 *
 * The same `before` cell resolves the DropAnchor, so the line cannot advertise
 * one insertion point and commit another. Four cases, and they are all about
 * ROW WRAPS:
 *
 *   no `before`      — appending, so draw past the last cell's right edge.
 *   row-end anchor   — the boundary starts a new row AND the pointer is still
 *                      on the previous row, so the user means "after the last
 *                      cell of this row": draw at that row's end, not at the
 *                      start of the next one.
 *   mid-row          — between two cells on one row: split the gap.
 *   row start        — draw before the cell, out by half a gap.
 *
 * Returns null when there are no cells; the caller's empty-surface path covers
 * that case.
 */
export function gridIndicatorGeometry(
  input: Readonly<{
    cells: readonly GridCellGeometry[];
    gap: number;
    wrapperLeft: number;
    wrapperTop: number;
    clientX: number;
    clientY: number;
  }>,
): GridIndicator | null {
  const { cells, gap, wrapperLeft, wrapperTop, clientX, clientY } = input;
  const last = cells[cells.length - 1];
  if (last === undefined) return null;

  const before = cellFollowingPointer(cells, clientX, clientY);
  const beforeIndex = before ? cells.indexOf(before) : -1;
  const previous = (beforeIndex > 0 ? cells[beforeIndex - 1] : null) ?? null;
  // `- 1` absorbs sub-pixel row tops: two cells on one row can differ by a
  // fraction, and a bare `<` would read that as a wrap.
  const boundaryStartsRow = before !== null && previous !== null && previous.top < before.top - 1;
  const anchorPreviousRowEnd =
    boundaryStartsRow && previous !== null && clientY <= previous.bottom;
  const halfGap = gap / 2;
  const halfIndicator = 1;

  if (!before) {
    return {
      x: last.right + halfGap - halfIndicator - wrapperLeft,
      y: last.top - wrapperTop,
      height: last.bottom - last.top,
    };
  }
  if (anchorPreviousRowEnd && previous) {
    return {
      x: previous.right + halfGap - halfIndicator - wrapperLeft,
      y: previous.top - wrapperTop,
      height: previous.bottom - previous.top,
    };
  }
  if (previous && !boundaryStartsRow) {
    return {
      x: (previous.right + before.left) / 2 - halfIndicator - wrapperLeft,
      y: before.top - wrapperTop,
      height: before.bottom - before.top,
    };
  }
  return {
    x: before.left - halfGap - halfIndicator - wrapperLeft,
    y: before.top - wrapperTop,
    height: before.bottom - before.top,
  };
}

/**
 * Re-read an anchor against a CURRENT list of ids, as a boundary index.
 *
 * Prefer the successor: "before whatever followed the gap" survives the
 * predecessor being removed, which is the commoner edit. If both neighbours
 * are gone (or there were none), fall back to the original index, clamped to
 * what the list holds now.
 *
 * ONE function for both readings, which is new. `resolveAnchoredTarget` used to
 * carry this rule TWICE, ten lines apart and spelled differently — a nested
 * ternary over `ids.indexOf(parseNodeId(…))` for the flat run, and an if-ladder
 * over `indexOfChildId` for the children. Same three cases, same precedence,
 * same clamp; only the list differs, which is the argument. The caller passes
 * the FLAT RUN in flat mode (yielding a flat boundary that
 * `resolveFlatDropTarget` then converts — the step a native drop skipped
 * entirely until PL12-005) and this collection's CHILDREN otherwise.
 */
export function resolveAnchorIndex(ids: readonly NodeId[], anchor: DropAnchor): number {
  if (anchor.afterId !== null) {
    const at = indexOfChildId(ids, anchor.afterId);
    if (at >= 0) return at;
  }
  if (anchor.beforeId !== null) {
    const at = indexOfChildId(ids, anchor.beforeId);
    if (at >= 0) return at + 1;
  }
  return Math.max(0, Math.min(anchor.index, ids.length));
}
