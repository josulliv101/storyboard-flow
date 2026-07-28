# Punch List 08

## PL8-001 — Click-away deselects from anywhere, not just the surface

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Graph view — selection clearing (extends PL7-001)
- Screenshot: Not captured

PL7-001 clears the selection on an empty-space click, but only inside a
strip or grid container. Any click that is not itself an action should
count as clicking away: page background, the board's padding, the header
row, the area beside the surfaces. Clicking a control that does something —
a button, a link, a toggle, a card — is an action and must not deselect.

Reference: `useBackgroundSelectionClear` in
`packages/ui/dnd-collections/react/use-background-clear.ts`, wired to the
`VirtualStrip` / `VirtualGrid` containers. The rule needs to move up to a
page-level listener while keeping the same non-action test.

Acceptance criteria:

- With a selection active, a click anywhere that does not trigger an action
  clears it — including outside any strip or grid.
- Clicks on buttons, links, inputs, cards, drag handles, trim handles, the
  seek rail, the divider, and sidebar controls do NOT clear the selection.
- A click that ends a drag, a pan, or a trim does not clear it (the
  press-position guard still applies).
- A double-click's second click does not clear it.
- Ctrl/Cmd+click toggle and plain card-click replace still behave as now.
- Clearing does not move the playhead, change focus, or scroll the page.

## PL8-002 — Collapse a long breadcrumb behind a clickable "…"

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-view-chrome.tsx` — `GraphBreadcrumb`
- Screenshot: Not captured

A deep timeline path renders every ancestor crumb, so the trail crowds the
header. Omit the middle crumbs behind a "…" that can be clicked to reach
any of them.

Reference: `GraphBreadcrumb` maps `timelinePath.slice(0, -1)` into
`AncestorCrumb`s. Crumbs are also DROP TARGETS during a card drag
(`graph-breadcrumb-drop.tsx`), which the overflow has to keep in mind.

Acceptance criteria:

- When the trail is too long for the header, middle crumbs collapse into a
  single "…" indicator.
- The "…" is a real control: activating it lists every omitted crumb and
  navigating to one works.
- The root crumb and the current (focused, renamable) crumb are never
  collapsed.
- Short trails render exactly as they do now, with no "…".
- The overflow control is keyboard reachable and screen-reader labelled.
- The header does not overflow horizontally at any width.
- Crumb drop targets still work for the crumbs that remain visible;
  collapsing must not break the drag/drop path.

## PL8-003 — Collection card glyph slightly smaller inside its circle

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Collection card drill affordance (`graph-item-content.tsx`)
- Screenshot: Not captured

The circular drill button on a collection card is the right size, but the
`CornerRightDown` glyph inside it is too large for the circle.

Today: the button is `aspect-square h-[34%]` and the glyph is
`h-[55%] w-[55%]` of it.

Acceptance criteria:

- The circle keeps its current diameter.
- The glyph is visibly smaller inside it, with more breathing room.
- It stays centred and crisp at every item size, strip and grid.
- The empty-collection ghost glyph (the one on a card with no preview) is
  reviewed for the same proportion.

## PL8-004 — Divider grip becomes a GripHorizontal at the far left

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — divider grip (revises PL7-005d)
- Screenshot: Not captured

PL7-005 added a plain pill mark left of the transport at `md` and below.
Replace it with the lucide `GripHorizontal` icon, positioned at the far
LEFT end of the divider rather than near the centre.

Acceptance criteria:

- The grip renders as `GripHorizontal`, at the divider's left end.
- Still shown at `md` and below only; unchanged above it.
- It does not collide with the transport controls or the time readout at
  any width down to 320px.
- It stays decorative (`aria-hidden`) and never intercepts the resize drag.

## PL8-005 — Reorder drop indicator is not centred in the gap

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Strip/grid reorder indicator (`virtual-strip-geometry.ts`,
  `VirtualStrip`, `VirtualGrid`)
- Screenshot: Not captured

Dragging an item to a new position draws a blue vertical bar at the
boundary. It does not always land centred in the gap between the two
neighbouring cards.

Reference: `indicatorLeftOffset(edgeStart, gap)` returns
`max(0, edgeStart - gap / 2)`, and the bar is `w-1 -translate-x-1/2`. The
`max(0, …)` clamp is one suspect at the leading boundary; the rendered gap
disagreeing with the `gap` prop, and the first-item trim gutter, are
others. Diagnose before changing the formula.

Acceptance criteria:

- The bar is centred in the gap at every boundary, including the first
  (before the first card) and the last (after the last card).
- Correct in both strip and grid, at every item size and zoom.
- Still correct while a trim gutter is in effect on the first card.
- The boundary the bar marks is still the boundary the drop commits to.

## PL8-006 — Divider visible height slightly less

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — `data-divider-line` (revises
  PL7-005a)
- Screenshot: Not captured

PL7-005 made the visible band 12px. Trim it a little. The hit target stays
where it is.

If the band must remain 12px at tablet width and below to host the PL8-004
grip icon, that is acceptable — the reduction can be desktop-only.

Acceptance criteria:

- The visible band is shorter than 12px at desktop width.
- The drag hit target keeps its current height.
- `DIVIDER_HEIGHT_PX` and the rendered box stay in sync — the constant
  feeds `--workbench-preview-offset` and the sticky preview offset.
- The transport stays centred on the band and legible against it.
- Existing divider e2e and story expectations are re-synced.

## PL8-007 — Preview close button needs more inset from the corner

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — preview close button
- Screenshot: Not captured

The close button in the preview's top-right corner sits too close to the
edges. Today: `absolute right-2 top-2`.

Acceptance criteria:

- The button has visibly more space from the top and right edges.
- It stays inside the preview surface and clear of the letterboxed frame.
- Hit target and focus ring are unchanged.
- It does not overlap the scrub readout or any other preview overlay.

## PL8-008 — Breadcrumb drop hint loses its background

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-breadcrumb-drop.tsx` — `DropZone` hint branch
- Screenshot: Not captured

While dragging a card over a breadcrumb crumb, the right-hand zone borrows
its pixels to read out "Drop into <name>". That readout should have no
background fill.

Today the hint branch applies `bg-zinc-800/75` (or `bg-zinc-900/70` when
invalid) plus `shadow-sm`.

Acceptance criteria:

- The hint readout renders with no background fill and no drop shadow.
- Its icon and text stay legible over whatever is behind it.
- The TRASH drop zone's own appearance is untouched — its idle, `over`, and
  `invalid` states keep their current backgrounds.
- The zone's droppable hit rect is unchanged (it stays mounted either way).
- The invalid variant is still visually distinct from the valid one.

## PL8-009 — Sidebar folder badges move to the bottom-right

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `timeline-sidebar.tsx` — `MediaFolderIcon` and the trash folder icon
- Screenshot: Not captured

Both bottom-of-rail folder icons carry a small badge (an image glyph for
assets, a trash glyph for the trash). Move the badge from the folder's
top-right corner to its bottom-right.

Today both use `absolute -top-1 -right-1`.

Acceptance criteria:

- Both badges sit at the folder's bottom-right corner.
- The badge keeps its size, ring, and background treatment.
- Neither icon's overall footprint changes, and the rail's spacing and
  alignment are unaffected.
- The trash icon's drop-hover and arrival animations still work.

## PL8-010 — Trim the "No child timelines" empty state

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-sub-timelines.tsx` — `SubTimelines` empty state (revises
  PL7-004)
- Screenshot: Not captured

The empty state added in PL7-004 carries a second explanatory line and is
centred. Reduce it to the heading alone, left aligned, with an icon that
reads as a tree node.

Acceptance criteria:

- The panel shows "No child timelines" and nothing else.
- Content is left aligned, not centred.
- A tree-node icon precedes the text and reads as part of the tree.
- Still top-level only, still only when the children toggle is on.
- Still reachable to assistive tech and still replaced by the real row as
  soon as a child timeline exists.

## PL8-011 — Active play/pause is a black glyph in a white circle

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — transport primary control
- Screenshot: Not captured

In its active state the play/pause button should invert: a white filled
circle with the glyph drawn black inside it.

Today the control is background-free — a `size-5` `rounded-full` span
(`data-transport-primary-control`) that only changes text color, going
`text-zinc-400` → white when the preview is hovered or on button hover.

Read as: "active" is that highlighted state (preview hovered / hover), the
same condition that whitens the glyph today. Say if you meant the pressed
`:active` state instead — the work is different.

Acceptance criteria:

- In the active state the control paints a solid white circle with a black
  glyph; play and pause both.
- The resting state is unchanged — still background-free, still zinc.
- The circle keeps the control's current diameter, so nothing shifts as it
  activates, and the 44px hit target is untouched.
- Contrast holds against the divider band behind it.
- The focus ring stays visible against the white fill.
- The e2e that asserts `data-transport-primary-control` has a transparent
  background is scoped to the RESTING state, or updated.

## PL8-012 — Card icon and its sub-timeline row highlight together

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Collection card drill icon ↔ `SubTimelineNode` folder row
- Screenshot: Not captured

With child timelines enabled, a collection appears twice: as a card in the
surface and as its own row below. Hovering one should highlight the other,
in both directions, so the pairing is visible.

The two are matched by the collection's node id — the card's `data-node-id`
and the row's collection id are the same value.

Acceptance criteria:

- Hovering a collection card's icon highlights that collection's
  sub-timeline row.
- Hovering that row's folder highlights the card's icon.
- The highlight only appears while child timelines are enabled — with the
  toggle off there is no row to pair with.
- Only the matching pair highlights; sibling collections are unaffected,
  including when several rows are expanded and nested.
- The highlight clears on pointer-out, and on the row unmounting mid-hover.
- Nothing about layout, selection, drag, or the drill/expand actions
  changes — this is a hover affordance only.
- The pairing survives scrolling and virtualization: an unmounted card or a
  collapsed row simply has nothing to highlight, and must not error.
