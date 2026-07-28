# Punch List 07

## PL7-001 — Clicking empty space clears the selection

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Graph board — selection surface (strip and grid)
- Screenshot: Not captured

With one or more items selected, clicking empty space away from any card
leaves the selection intact. Selection can currently only be changed by
clicking another card, so there is no way to get back to "nothing selected"
with the mouse.

Assumed scope (correct me if wrong): an empty-space click inside the board's
own content area clears the selection; clicks on surrounding chrome
(toolbar, breadcrumb, sidebar, preview pane, ruler/seek rail) do not.

Acceptance criteria:

- Clicking empty space inside a strip or grid, with a selection active,
  clears the selection.
- Clicking a card still selects it (replace semantics), and Ctrl/Cmd+click
  still toggles — neither path regresses.
- A click that ends a drag, a pan, or a trim does not clear the selection.
- A double-click's second click does not clear the selection (the existing
  `event.detail > 1` guard stays honored).
- Clicking chrome outside the board content area leaves the selection alone.
- Clearing the selection does not move the playhead or change focus/scroll.

## PL7-002 — Native-drop indicator in grid renders behind cards and off-target

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Grid view — `NativeDropGrid` drop indicator
- Screenshot: Not captured

Dragging a file in from the OS file manager onto the grid draws a vertical
amber insertion line, but it paints underneath the grid cards and the
boundary it marks does not match where the file actually lands.

Reference: the indicator element and its 2-D boundary math are in
`graph-native-drop.tsx` (`NativeDropGrid`, `flushIndicator` /
`cellBeforeWhichPointerFalls`), drawn at `z-20` inside the drop wrapper.

Acceptance criteria:

- The insertion line paints above grid cards, their artwork, and the
  playhead/seek-rail overlays for the whole drag.
- The line's position marks the boundary the drop actually commits to —
  advertised index and committed index agree at every pointer position,
  including the last cell of a row, the first cell of a row, and past the
  final card (append).
- The line stays correct while the pointer moves within a row, between rows,
  and after the grid scrolls or resizes mid-drag.
- Dropping commits the file at the marked boundary.
- The line clears on drag leave, drop, and cancel.
- Strip-view native drop is unaffected.

## PL7-003 — Show drop-zone affordance during a native file drag

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Graph board and sub-timelines — native file drop targets
- Screenshot: Not captured

While a file is dragged in from the OS, nothing on the page indicates which
regions will accept it. The only feedback is the insertion line, which
appears after the pointer is already over a target. The drop targets should
announce themselves for the duration of the drag.

Every `NativeDropStrip` / `NativeDropGrid` is a target: the focused
timeline's strip or grid, plus each rendered sub-timeline's strip or grid.

Acceptance criteria:

- As soon as a native file drag enters the page, every drop target takes a
  visible style change that reads as "droppable here".
- The target under the pointer is distinguished from the other, merely
  eligible, targets.
- The affordance ends on drop, drag leave, and drag cancel, leaving no
  residual styling.
- The affordance appears only for drags that carry files — an internal card
  drag does not trigger it.
- The styling does not shift layout (no reflow of cards, strip scroll
  position, or preview height) as it appears or clears.
- It coexists with the PL7-002 insertion line without obscuring it.
- It respects reduced-motion preferences if it animates.

## PL7-004 — Empty state when child timelines are shown but there are none

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Graph board — FolderTree "show child timelines" toggle / `SubTimelines`
- Screenshot: Not captured

With the child-timelines toggle on, a focused timeline that contains no
child timelines renders nothing below the focused surface. The toggle reads
as broken — there is no way to tell "the feature is on and there is nothing
to show" from "the toggle did nothing".

Reference: `childrenShown` gates the `SubTimelines` mount in
`graph-board.tsx`; with no child collections it produces no rows.

Acceptance criteria:

- With the toggle on and no child timelines present, a short empty-state
  indicator appears where the child rows would render.
- The indicator makes clear the feature is enabled and the timeline simply
  has no children.
- With the toggle off, nothing renders — no empty state.
- As soon as a child timeline is added, the empty state is replaced by the
  real row without a reload.
- The indicator is reachable to assistive tech (not `aria-hidden`) and does
  not disturb the preview height, playhead, or page scroll.
- Scope is the top-level (focused) timeline ONLY, and only when it has no
  child timelines. Childless sub-timeline rows never render the empty state.

## PL7-005 — Divider height, transport icon size, top padding, touch grip

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — resize divider and preview transport
- Screenshot: Not captured

Four changes to the preview/timeline divider band:

(a) Make the VISIBLE divider a 12px band rather than the current 1px
centerline (confirmed with the user). The interaction track is already 12px
(`DIVIDER_HEIGHT_PX = 12`, the `h-3` button), so this is a restyle of the
`data-divider-line` span, not a geometry change.

(b) Play/pause and skip icons slightly larger. Today: `Play`/`Pause` are
`size-2.5` (10px), `SkipBack`/`SkipForward` are `size-3` (12px), inside
`size-5` wells in `size-11` buttons.

(c) Small padding above the divider, between the preview surface's bottom
edge and the divider band.

(d) At tablet width and below, show a persistent indicator that the divider
is draggable (a grip). Breakpoint: `md` (≤768px), confirmed with the user.
Coarse-pointer devices have no hover, so the hover-only line-brighten is
invisible to them.

Acceptance criteria:

- The visible divider reads as a 12px band; the transport controls stay
  centered on it and remain legible against it.
- `DIVIDER_HEIGHT_PX` and the divider's rendered height stay in sync — it
  feeds `--workbench-preview-offset` and the sticky preview offset math.
- Transport icons are visibly larger while staying inside their wells; hit
  targets stay at least 44px.
- A small gap separates the preview surface from the divider; no other
  vertical rhythm shifts.
- At ≤ tablet width the grip is visible without hover; above it, current
  behavior is unchanged.
- Resize drag, keyboard resize, and the transport's pointer-down isolation
  (a transport press must not start a resize) all still work.
- Existing preview-height e2e expectations are re-synced if the total
  preview region height changes.

## PL7-006 — Sidebar collection-tool drag shows the same broken grid indicator

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Grid view — sidebar tool drag into `NativeDropGrid`
- Screenshot: Not captured

Dragging a new collection item from the sidebar tool palette into grid view
draws the amber insertion line in the wrong place and under the grid.

SAME ROOT CAUSE AS PL7-002. `acceptsNativeDrag` admits both the sidebar
tool MIME and OS `Files`, and both drag sources then share one indicator and
one `flushIndicator` boundary calculation. Fix once; verify twice.

Acceptance criteria:

- All PL7-002 criteria hold for a sidebar tool drag as well as an OS file
  drag.
- Both drag sources are covered by the verification, in grid and in strip.
- The new collection lands at the boundary the line marked.

## PL7-007 — Collection cards in strip view need a 16:9 minimum width

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Strip view — collection card width (`collectionCardWidth`)
- Screenshot: Not captured

Collection cards in the strip may grow wider with the zoom slider, but they
must never get narrower than a 16:9 box against the card's rendered height.

Today `collectionCardWidth(pixelsPerSecond)` returns
`max(MIN_ITEM_WIDTH, 128 * pps / TIMELINE_PPS)` — a flat pixel floor with no
relationship to card height, so zooming out squeezes collections to a narrow
sliver. The new floor is `height * 16 / 9`.

Note this widens collections at default zoom too: at the MD strip height
(100px) the floor is ~178px against today's 128px base.

Reference: `graph-preview.tsx` (`collectionCardWidth`, `clipWidthAt`),
consumed by `graph-board.tsx` and `graph-sub-timelines.tsx` as the strip's
`itemWidth`. The function currently takes only `pixelsPerSecond` and will
need the card height.

Acceptance criteria:

- A strip collection card is never narrower than `height * 16 / 9`.
- Above that floor it still scales with the zoom slider as it does now.
- The floor tracks the rendered card height, so it differs per item size and
  for the one-step-smaller sub-timeline rows.
- The strip's `itemWidth`, the playhead model's `clipWidthAt`, the ruler's
  collection spans, and the strip seek rail all read the SAME width — the
  playhead must not drift off the cards at any zoom.
- Media clip widths stay duration-proportional and unchanged.
- Grid view is unaffected (its cells are already fixed-size).
- Ruler collection-duration labels still fit or still hide by the existing
  minimum-width rule.

## PL7-008 — Ruler toggle only in flat view, and below the flat-view icon

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Sidebar rail — ruler and flat-view toggles (`timeline-sidebar.tsx`)
- Screenshot: Not captured

Today both toggles render whenever the surface is a strip, with the ruler
ABOVE flat mode. The ruler should be gated on flat view being enabled, and
should sit BELOW the flat-view icon.

Reference: `timeline-sidebar.tsx` — the ruler button is gated on
`onGraphRoute && graphView.surface === "strip"` and is rendered before the
flat button; swap the order and add the `flatOn` condition.

Acceptance criteria:

- The ruler toggle is hidden unless flat view is on; the flat toggle keeps
  its current strip-only gate.
- In the rail, the ruler icon renders below the flat-view icon.
- Turning flat view off also turns the ruler off, so no strip is left with a
  ruler and no visible control to dismiss it. (Assumption — say if the ruler
  state should instead persist for the next time flat is enabled.)
- Grid view shows neither toggle, unchanged.
- Tooltip, `aria-pressed`, and `aria-label` wiring stay correct for both
  buttons after the reorder.
- Any e2e that finds these buttons by position or by enabling the ruler
  without flat mode is updated.

## PL7-009 — Replace the collection glyph with CornerRightDown

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Collection cards — `CollectionFolderGlyph` (`graph-item-content.tsx`)
- Screenshot: Not captured

Swap the collection icon from lucide `FolderInput` (folder-with-arrow) to
`CornerRightDown`.

`CollectionFolderGlyph` is one component used in two places, so replacing it
covers both: the empty/no-preview collection ghost centred on the card, and
the circular drill ("Open <name>") button overlaid on collection cards.

There is a THIRD `FolderInput` in `graph-breadcrumb-drop.tsx` — the
move-to-parent breadcrumb drop zone. Assumed OUT OF SCOPE: that is a
different verb (move into) from the collection identity/drill icon. Say if
it should change too.

Acceptance criteria:

- Both `CollectionFolderGlyph` sites render `CornerRightDown`.
- The glyph stays centred and fully visible in the card ghost and inside the
  circular drill button at every item size, with the current stroke weight
  and color treatment.
- No stray `FolderInput` import is left behind in `graph-item-content.tsx`.
- Accessible names ("Open <name>", the card's collection label) are
  unchanged — this is a glyph swap only.
- Any story or e2e that asserts on the old icon is updated.
