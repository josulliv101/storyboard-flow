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
