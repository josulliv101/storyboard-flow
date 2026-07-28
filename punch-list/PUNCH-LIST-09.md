# Punch List 09

## PL9-001 — Trailing "add a collection" placeholder in every strip and grid

- Status: Open
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Strip and grid surfaces — trailing add affordance
- Screenshot: Not captured

Adding a nested timeline today means reaching for the sidebar's collection
tool. Every strip and grid should end with a placeholder slot that adds one
in place, at the end of that surface.

Read as a new COLLECTION (nested timeline) — the same thing the sidebar's
collection tool mints, which is the only insert tool there is. Say if you
meant a generic "any item" slot.

Reference: `requestGraphToolInsert("collection")` →
`SidebarToolInsertBridge` / `useToolInsertion` is the existing mint-and-
insert path; the sidebar routes through `resolveInsertPlacement`, which is
selection-aware. A trailing placeholder means "append HERE" and should not
inherit that placement rule.

Acceptance criteria:

- Every strip and every grid ends with a placeholder slot, after the last
  card — the focused surface and each rendered sub-timeline surface alike.
- Activating it appends a new collection to THAT surface's collection,
  regardless of what is selected elsewhere.
- The new timeline lands as an ordinary undoable commit, and persists like
  any other insert.
- The placeholder is not an item: it must not be counted by the strip/grid
  boundary math, the playhead or ruler models, the header aggregate,
  keyboard roving, or selection.
- Dropping a card or a file at the end of the surface still lands after the
  last real card — the placeholder must not absorb or displace the drop.
- It is keyboard reachable and labelled, and reads as an affordance rather
  than as a card.
- An EMPTY collection shows it alongside (or in place of) the existing
  "Drop items here" hint, without the two fighting for the same pixels.
- It scrolls with the content — in a virtualized strip that means it sits
  after the last card at the true content end, not pinned to the viewport.

## PL9-002 — Pair highlight becomes one-way, onto the card's border

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-collection-hover.tsx`, collection card, sub-timeline row
  (revises PL8-012)
- Screenshot: Not captured

PL8-012 made the pairing bidirectional and lit the card's drill ICON. Narrow
it to one direction and move the highlight:

- Hovering a child timeline's FOLDER calls out the matching collection card
  with a brief ANIMATION, not a static border or icon change.
- Hovering the collection card no longer highlights the child's folder. That
  direction goes away entirely.

Proposed animation (confirm or redirect): a one-shot attention pulse on
hover-enter — a glow that rises and falls over ~250ms — then the card rests.
A one-shot says "this one" and gets out of the way; a looped pulse would sit
there throbbing for as long as the pointer rests on a folder, which in a tree
of many rows is most of the time.

Reference: `useCollectionHoverPair` currently drives `data-collection-paired`
on both the card's drill button (`graph-item-content.tsx`) and the row's
folder toggle (`graph-sub-timelines.tsx`). The e2e "a collection's card icon
and its child-timeline row highlight together" asserts the old two-way
behaviour and needs rewriting, not deleting.

Acceptance criteria:

- Hovering a sub-timeline row's folder animates that collection's card; the
  card's icon is unchanged.
- Hovering a collection card (icon or body) does nothing to the tree.
- Only the matching card animates — siblings, nested rows, and other
  expanded rows are unaffected.
- Moving between folders re-fires cleanly: the previous card's animation
  ends and the new one plays, with no pile-up when moving quickly.
- Nothing is left mid-animation if the card unmounts, scrolls out of a
  virtualized surface, or the row collapses mid-hover.
- Still only while child timelines are enabled.
- No layout shift and no disturbance to neighbours: the effect is drawn
  outside the box (glow/ring/shadow), not by changing size or spacing.
- Reduced motion is respected — the connection still reads without the
  animation. NOTE: `motion-safe:` cannot prefix a hand-rolled keyframe
  class; use a `prefers-reduced-motion` media block, as the sidebar trash
  pulse had to.
- Element OPACITY is not the vehicle: it made the sidebar trash target
  translucent and let what was behind it bleed through. Animate the glow.
- It stays a hover affordance: selection, drag, drill and expand are all
  untouched, and the card's selected/rejected states still read clearly
  while it plays.

## PL9-003 — Timestamp tooltip while the playhead is being dragged

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Seek rails / playhead (`graph-preview.tsx`)
- Screenshot: Not captured

Dragging the playhead gives no readout of where it is going. Show the
timestamp in a tooltip that follows it, only for the duration of the drag.

Note on what "the playhead" means here: the red line is PASSIVE — R7 settled
that scrubbing is done by dragging the seek rail's thumb, which is what moves
the line. So this is the rail drag: `GraphStripSeekRail` in the strip and
`GraphSeekRails` in the grid. The divider transport already shows the current
time, but it is up in the preview chrome, far from the pointer.

Assumed pointer-only, per "actively being dragged" — keyboard seeking (the
rail is a `role="slider"` with arrow/Home/End) does not raise it. Its
`aria-valuenow` already speaks the position. Say if you want it there too.

Acceptance criteria:

- Pressing and dragging a seek rail shows a tooltip with the timestamp at
  the playhead, updating live as it moves.
- It appears on drag start and disappears on release, on cancel, and if the
  pointer leaves the window mid-drag — never left behind.
- It does not show on hover alone, on a parked rail, or during playback.
- The format matches the transport's existing readout, so one clock is not
  spelled two ways.
- It tracks the thumb through the strip's edge auto-pan, and stays legible
  and on-screen at both ends of the timeline rather than clipping.
- Both surfaces: the strip's rail and the grid's per-row rails, including
  a drag that crosses from one grid row into the next.
- Purely presentational — it must not intercept pointer events, disturb the
  drag, or change the scrub math.
- It does not shift layout or reflow the strip as it appears.

## PL9-004 — Drop the preview's border, raise its close button

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `workbench-display-surface.tsx` — preview surface and close button
  (revises PL8-007)
- Screenshot: Not captured

Two tweaks to the preview:

(a) Remove the border around the preview area. Today the surface carries
`border border-zinc-800` alongside `rounded-lg bg-zinc-950 shadow-2xl`.

(b) The close button sits slightly too low. PL8-007 moved it to
`right-4 top-4`; raise it, keeping the right inset.

Acceptance criteria:

- No border is drawn around the preview surface.
- Removing it changes no geometry: the border is 1px on each side, so the
  canvas must not grow into it or the preview height, the divider's box, and
  `--workbench-preview-offset` all shift by a pixel or two.
- The rounded corners and the surface's own background still read as a
  distinct area against the page.
- The close button is visibly higher, still clear of the top edge and of the
  letterboxed frame beneath it.
- Its hit target, focus ring, and hover treatment are unchanged.
- The e2e that asserts the surface's `borderBottomWidth` is `0px` (it checks
  the divider sits flush) still holds, and any story or e2e that reads the
  surface's border is re-synced.

## PL9-005 — Scrubbing across an empty collection loses the cursor

- Status: STRIP done; GRID rails still to do
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Seek rails and playhead (`graph-playhead-model.ts`,
  `graph-preview.tsx`)
- Screenshot: Not captured

An empty collection occupies WIDTH on screen but contributes no TIME, so
dragging the playhead across it makes the line jump ahead to the next card
while the pointer is still crossing the empty one. Pointer and playhead come
apart, and the drag stops feeling connected to anything.

Skipping is right during PLAYBACK — there is nothing there to play. It is
wrong while scrubbing, where the user is steering a position on screen.

Likely shape: `buildPlayheadMap` is a piecewise time↔x map, and the playhead
paints from `xAt(time)`. A zero-duration span means many x values share one
time, so the round trip x → `timeAt` → `xAt` cannot come back to where the
pointer is. While a scrub drag is live the line wants to follow the POINTER
directly, emitting whatever time that x maps to, and hand back to the
time-driven position on release. Confirm the empty-collection span really is
zero-width in time before building on that.

DONE (strip): the channel now carries a scrub POSITION beside the time —
`PreviewScrubPosition`, scoped by surface id — and the strip's playhead line
and rail thumb both ride it while that surface is being dragged. Proven
fail-first: without it the line does not move AT ALL across an empty card
(824.33 → 824.33 over the whole crossing).

NOT DONE (grid): `buildGridPlayheadMap.posAt` collapses a zero-duration cell
the same way, so the grid's rails need the same treatment. It needs a `y` on
the scrub payload (a grid position is a row as well as an offset) and the
grid rail computing both in grid content coordinates.

Acceptance criteria:

- While dragging, the playhead stays under the pointer for the whole width
  of an empty collection — it slides across rather than jumping past it.
- The time it reports while crossing is still the honest one (the empty
  collection adds no playable time); only the LINE's position is pointer-led.
- On release the playhead sits where the pointer left it, and the normal
  time-driven position takes over again without a visible snap.
- PLAYBACK is unchanged: an empty collection is still skipped as it plays.
- Several empty collections in a row, and an empty collection at the very
  start or end of a timeline, all behave the same way.
- A collection that is merely un-hydrated is not treated as empty — it has
  a stored duration and must keep it.
- Strip and grid rails alike, including a grid drag crossing rows.
- The ruler, the rail's fill and thumb, and the playhead line stay in
  agreement throughout the drag.

## PL9-006 — Tree-node mark to the left of each child row's folder

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-sub-timelines.tsx` — `SubTimelineNode` row header
- Screenshot: Not captured

Child timeline rows lead with a folder icon. Keep it, and add a small
decorative mark to its LEFT so the row reads as a node in a tree rather than
as a free-standing panel.

Proposed (confirm or redirect): a single elbow connector — the `└─` corner —
sized to the row header and drawn in a muted zinc, immediately before the
folder button. The bigger alternative is a full tree spine: vertical rules
running down through each ancestor level, with the elbow branching off the
last one. That reads more like a real tree, but it has to know whether each
row is its parent's LAST child and has to line up across panel borders, so
it is a different-sized job. Starting with the elbow.

Reference: rows nest recursively through `SubTimelineNode` (`depth` prop),
and nesting is currently expressed by panel indentation
(`SUBTIMELINE_INDENT_PX` / `SUBTIMELINE_PANEL_RIGHT_INSET_PX`), not by any
connector. The row header is a flex line: folder button, name, clip count,
status badge, spacer, preview frames.

Acceptance criteria:

- Every child timeline row shows the mark immediately left of its folder
  icon, at every nesting depth.
- The folder icon itself is unchanged — same glyph, same open/closed states,
  same expand/collapse behaviour and hit target.
- The mark is decorative: `aria-hidden`, not focusable, and it does not
  become part of the row's accessible name.
- It does not disturb the header's layout — the name, badges, and the
  preview frames keep their positions and the frames stay aligned in their
  column across depths.
- It is muted enough to read as structure, not as another control competing
  with the folder.
- It shares its visual language with the "No child timelines" empty state's
  tree icon (PL8-010), so the two do not look like different systems.
