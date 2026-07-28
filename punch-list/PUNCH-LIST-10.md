# Punch List 10

## PL10-001 — Folder-hover call-out becomes an elastic squash-and-snap

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx` collection card call-out,
  `app/globals.css` keyframes (revises PL9-002)
- Screenshot: Not captured

PL9-002 settled the DIRECTION (hovering a child timeline's folder calls out
the matching collection card, one way only) and shipped a glow pulse as the
call-out. Keep the direction and the trigger; replace the glow.

The card should ELASTICALLY grow and snap back to its normal size — a spring
overshoot rather than a light effect. Still a one-shot on hover-enter, still
re-firing when the pointer moves between folders.

Assumption to confirm: it scales UP briefly (both axes, ~1.04) and springs
back past rest with a decaying overshoot, ~300ms. Say if you meant height
only, or a squash the other way (shrink first, then snap out).

Reference: the call-out today is a SIBLING overlay span
(`data-collection-called-out`, `.animate-collection-paired-callout`) mounted
only while the row is hovered — mounting is what restarts the one-shot, and
that mechanism should survive. But an inset overlay can only paint; scaling
it is invisible. The transform has to land on the CARD, so this either moves
the animation onto the selection surface's wrapper or keeps the overlay as
the mount-trigger and drives the card via a data attribute.

The globals.css note "nothing that changes the box" was about box-model
size in a virtualized strip. A `transform: scale` composites and does not
reflow neighbours — that is why this is allowed and a width/height animation
is not.

Acceptance criteria:

- Hovering a sub-timeline row's folder plays a one-shot elastic scale on the
  matching collection card, in both strip and grid surfaces.
- Moving between folders re-fires it on the newly matched card; re-entering
  the same folder replays it.
- No glow/ring remains from the old call-out.
- Neighbouring cards do not shift: the animation must not reflow the strip
  or grid (transform only, no width/height/margin).
- The scale is not clipped by the card's `overflow-hidden`, and it does not
  fight the selected (amber ring) or rejected (red ring) states.
- Under `prefers-reduced-motion: reduce` the connection still reads without
  motion — a steady, non-animated call-out held while the row is hovered.
- The PL9-002 e2e that asserts the one-way call-out is updated, not deleted.

Built as: `scale(1) → 1.06 → 0.985 → 1.012 → 1` over 320ms on a spring
curve — out fast, past rest, settle. The undershoot is what reads as elastic;
without it the card only inflates and deflates. The overlay span is deleted;
the card carries `is-called-out-card animate-collection-paired-callout`
(marker class, because SelectionSurface drops hyphenated `data-` props), and
adding/removing the class is what restarts the one-shot.

Live-measured at the paused peak: card 219.3×132 → 232.5×139.9 (1.06 both
axes), and no other `[data-node-id]` box moved. Reduced motion keeps the old
steady sky glow.

## PL10-002 — A flick over the folder plays the whole animation

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-collection-hover.tsx` (`useCollectionHoverTarget`)
- Screenshot: Not captured

Passing quickly over a folder and straight back out starts the PL10-001
animation and then cuts it off — the card twitches and stops. It should play
in full once triggered, whether or not the pointer stayed.

Acceptance criteria:

- A momentary hover plays the animation to completion after the pointer has
  left.
- Dwelling on the folder behaves as before; leaving after the animation has
  finished ends the call-out immediately.
- No strobing: wiggling over one folder does not restart it repeatedly.

Built as: the target hook returns `hovered || holding`, where `holding` is a
320ms latch timed from the FIRST trigger and deliberately NOT cancelled when
the pointer leaves. Timing it from the first trigger (rather than extending
it per re-entry) is what makes a wiggle finish the run in progress instead of
restarting it. `COLLECTION_CALLOUT_MS` must stay in sync with the keyframe
duration in globals.css — a short hold would cut the animation off again.

Note: a fast sweep DOWN the tree now leaves several cards animating at once,
one per folder passed. That is the same rule applied to each — say if you
want a sweep to call out only the folder the pointer settles on.

## PL10-004 — One trim panel, bounded and gated

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-trim-panel.tsx` (new, replacing `graph-trim-frame-preview.tsx`),
  `graph-trim-panel-context.tsx` (new), `graph-board.tsx`,
  `packages/ui/dnd-collections/react/trim-overview.tsx`,
  `packages/ui/dnd-collections/virtual/VirtualStrip.tsx`
- Screenshot: Not captured

Selecting a video summoned a source-window overview drawn at TIMELINE scale —
`fullDuration × pixelsPerSecond`, measured live at 4042px in a 1160px viewport
for an 80.8s source, running off both edges. Two problems in one: it is
unbounded, and it appears on selection, which is the cheapest and most frequent
action in the view.

Resolved as one panel above the selected card: the live frame on top, the whole
source fitted below it with the showing window and its grips. It shows on trim
INTENT — a live trim gesture, or pinned from the toolbar — never on selection
alone.

Why compose rather than shrink: the separate frame preview anchored to the
CARD's edge and only appeared to point at the overview's grip because both were
drawn in timeline scale. Fitting the map breaks that coincidence. In one panel
the grip and the frame cannot drift apart at any scale.

Acceptance criteria:

- The panel is a fixed width and always fully inside the viewport, whatever
  the source duration.
- The map inside it is the WHOLE source, with the window at the showing
  fraction.
- Selection alone does not show it; a trim drag does, pinned or not, and an
  unpinned panel retracts with the gesture.
- It never covers the clip it describes.
- The map still drives both gestures: grips trim, body moves the window.
- The package's own floating overview is off for this view — exactly one
  source map on screen, inside the panel.

Built as: `TrimOverviewStrip` gained an optional `width` (fitted mode: its own
scale for picture AND gestures), `VirtualStrip` gained `trimOverview: "auto" |
"off"`, and the app composes the two. Panel 320px, map 304px, placed above the
card by preference and below when there is no room (measured, not assumed —
the strip is the first row, so below is the usual case).

Two things that only showed up live:

1. A React portal bubbles through the REACT tree, so every press inside the
   panel reached the card that renders it and toggled the selection off,
   unmounting the panel mid-gesture. The old frame preview never hit this: it
   was `pointer-events-none`. The panel stops propagation at its root, after
   its own children have had the event.
2. The body drag was inverted. Unfitted, the caller slides the whole strip to
   keep the window over the clip, so the gesture is "drag the film". Fitted,
   the film is nailed to the panel and the window is what moves — the same
   pull sent the window the wrong way. Fitted mode negates the delta, so it is
   direct manipulation: drag right, window goes right.

Coarser by design: ~0.26s per pixel in the panel against the timeline's ~0.02.
The panel is the COARSE instrument (where in the source am I); the card's own
trim handles stay the fine one.

Note: verifying this on the demo project changed a clip's trim in `Intro`. It
was restored to trim-in 0 / 30.16s showing (measured original: 30.15s); the
~0.01s is measurement error, not a second edit.

## PL10-005 — The live frame moves into the breadcrumb band

- Status: Complete (first half — the map panel is still open)
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-trim-panel.tsx`
- Screenshot: Not captured

PL10-004's panel was wrong in three ways, two of them measured: the frame took
65% of its area against the map's 15% (the instrument got the sliver), and at
304px wide the map ran 0.172 s/px where a strip-wide one would run 0.048 —
the bound I chose set the precision. Third, it floated in empty space under
the card, reading as a popup that wandered in.

First half of the fix: the live frame becomes its own surface. During a trim
drag it sits in the BOARD HEADER's band — the breadcrumb row, already chrome —
at exactly that row's height, with the edge being dragged pinned to the
matching edge of the frame: out-edge drags hang its right on the clip's right,
in-edge drags its left on the clip's left. It grows inward over the clip, so
it never runs off the ends, and it displaces nothing.

The map panel keeps its place for now (pinned only) and lost its frame zone,
which was the 65%. Where the map itself should live — docked full-width under
the strip is the leading candidate, at ~0.05 s/px — is still open.

Acceptance criteria:

- The live frame appears only during a trim gesture and goes with it.
- Its height equals the board header's, measured (that row is sticky and its
  offset moves with the preview pane).
- The dragged edge's side of the frame aligns to the clip's matching edge.
- It clears the strip: nothing is displaced or covered below the band.

## PL10-006 — Dock the source map under the strip

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-trim-dock.tsx` (new), `graph-trim-panel.tsx`, `graph-board.tsx`,
  `packages/ui/dnd-collections/react/trim-overview.tsx`
- Screenshot: Not captured

Reported from a nested view: the pinned map was sitting on top of the
`Mugshots` sub-timeline row. Measured — 21,600px² of that row covered, plus
two collection cards.

Cause: the placement rule only asked whether the VIEWPORT had room above the
card. Inside a sub-timeline there is plenty of viewport up there — occupied by
the row above. Anything anchored to a card in a nested, scrolling board will
eventually cover something, so the fix is not better placement math.

The map is now IN THE FLOW, docked under the focused strip, full width. No
placement, no flip, no overlap — and it spans the strip, so the resolution
problem goes with it: ~0.05 s/px against the floating panel's 0.17.

Acceptance criteria:

- The dock overlaps no card and no sub-timeline row, at any drill depth.
- It appears only when pinned with a video selected, and takes no layout
  space otherwise.
- The map spans the strip; window, grips and slide gesture all still work.
- Pressing the dock's own chrome does not clear the selection out from under
  it.

Knock-on found while verifying: at fitted scale the trimmed-room dim (55%)
covered 850 of 942px and read as an empty black bar — the proportions invert
when a short clip comes from a long source. Fitted mode dims at 30% and lets
the amber window's border carry the distinction; the unfitted path is
unchanged.

## PL10-007 — The live frame belongs to the clip, not the header

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-trim-panel.tsx`
- Screenshot: Not captured

PL10-005 read the brief wrong. "The height of the breadcrumb row" is a SIZE,
not an address: the frame was being parked in the header band, which is fine
when the focused strip is the top row and wrong everywhere else — trimming a
clip in a sub-timeline put the preview a screen away from the pointer.

It now hovers directly above the clip being trimmed, 8px up, still sized to
the breadcrumb row's measured height (16:9 from it). It may still land over
the header when the focused strip is the top row; that is incidental, not the
anchor.

Acceptance criteria:

- The frame sits directly above the clip being trimmed, at any drill depth.
- Height still equals the board header's, measured.
- The dragged edge's side of the frame still aligns to the clip's matching
  edge.

Live-measured in a sub-timeline row: frame at y=302 for a card at y=367 — 8px
above it and 232px BELOW the header, where the old placement would have put
it. Focused-strip case unchanged: 8px above the card, right edge on the clip's
right edge to the pixel.

Known edge: when the clip is wider than the viewport its trimmed edge can be
off-screen, and the frame clamps into view rather than following the edge out
of it. Only reachable synthetically — a real drag holds the handle, which is
on screen by definition.

## PL10-008 — Experiment: the clip grows into a modal

- Status: Complete (experiment — keep or discard)
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-trim-modal.tsx` (new, replacing `graph-trim-dock.tsx`),
  `graph-board.tsx`, `app/globals.css`
- Screenshot: Not captured

The board already carries a strip, a tree, a preview, a ruler and a rail. Every
placement for the source map was a fight with one of them. So instead of
placing it: the toolbar icon now grows the selected clip into a MODAL via CSS
view transitions, the rest goes behind a scrim, and the clip has the screen.

Inside: the frame (large, seeked to the edge being dragged), the whole source
with its window and grips (the trim handles, at 734px), and the in/out
readout. Escape, the scrim, the close button and the toolbar icon all close it
through the same reverse transition.

Acceptance criteria:

- The card morphs into the modal's frame rather than the modal fading in.
- Exactly one element carries the shared `view-transition-name` at any time.
- The grips still trim, and the film still moves the window.
- Escape closes it and it reopens correctly — a stranded transition name
  would silently kill the morph on the second open.

TRAP worth remembering: while a view transition runs, the browser paints a
SNAPSHOT over the page, and a snapshot is an image — real pointer events land
on `<html>` for those ~260ms, so anything clicked mid-morph does nothing at
all. It cost an hour reading like a dead gesture: `elementFromPoint` returned
the grip while the real pointerdown reported `target=HTML`. Synthetic events
dispatched straight at an element skip hit-testing entirely, which is why the
same drag "worked" when scripted and failed with a real mouse. The e2e now
settles the transition first (`settleViewTransition`).

## PL10-009 — Undo where the trims happen

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-actions.tsx` (keyboard), `graph-trim-modal.tsx` (buttons)
- Screenshot: Not captured

Each trim drag commits on release, so overshooting is normal and stepping back
is the common need. Two things were missing.

First, the app had NO keyboard undo at all — `Ctrl/Cmd` + C/X/V/D and nothing
else. Undo/redo existed only as the toolbar's two buttons, which the trim modal
covers. Ctrl/Cmd+Z now undoes and Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes, from the
same window-level handler, app-wide — the grid and the tree get it too. Key
repeat is deliberately allowed here (holding steps back) where the clipboard
actions refuse it.

Second, the modal has its own undo/redo, SCOPED to this clip. A bare pair would
have been wrong: history is global and linear, so a third press could revert a
delete made on the board before the modal opened, behind the scrim, unseen.
They are enabled only while the next entry is an `update-media` on this node,
so they walk back the trims made in here and grey out at the boundary of them.

Redo is COUNTED rather than inspected — `historyEntries` is the applied log and
the redo branch isn't in it. Each scoped undo adds one, each redo spends one,
and a commit from anywhere drops the branch (`canRedo` false), which zeroes the
count.

Acceptance criteria:

- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work anywhere in the graph view, including
  with the modal open, and never fire inside a text field.
- The modal's undo is disabled when the newest entry belongs to another node,
  even though the store itself can undo.
- One press per trim; the neighbouring clip's earlier edit stays untouched.

Both e2e-pinned, and the scoping proven to fail without its gate (with the
selector relaxed to plain `canUndo`, the button was enabled over another
node's edit).

## PL10-003 — The call-out must not flash a scrollbar

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx` (`GraphCollectionItem` wrapper)
- Screenshot: Not captured

Calling out the last card in a row briefly flashes a scrollbar.

Cause: a transform that spills outside its box still counts as SCROLLABLE
overflow, so the scaled card grew its scroller (measured: the strip's
`overflow-x-auto` box went 132 → 136 tall at the peak, and the card's own
container 235 → 242 wide) and the browser showed a bar for the length of the
animation.

Acceptance criteria:

- No scrollbar appears or flashes on any surface while the call-out plays.
- The card's growth is still fully visible — not clipped to its box.
- Drop indicator bars, which sit half a gap outside the card by design, stay
  visible.

Built as: the collection card's wrapper is `overflow: clip` with
`overflow-clip-margin: 12px`. `clip` (not `hidden`) swallows the overflow
without turning the wrapper into a scroll container, and the 12px margin
clears both the card's ~7px growth and the drop bars' ~4px. E2E pins that no
ancestor above the wrapper changes scroll size between rest and peak; proven
to fail without the clip (three ancestors grew, the strip's scroller among
them).
