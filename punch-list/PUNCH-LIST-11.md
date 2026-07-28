# Punch List 11

## PL11-002 — The details trigger moves onto the item

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx`, `graph-item-details-context.tsx`,
  `graph-item-details-modal.tsx`, `graph-board.tsx`
- Screenshot: Not captured

The toolbar was the wrong home for a per-item control. The trigger now sits in
the top-right of the media card itself: hidden at rest, revealed on hover or
on keyboard focus, and a real tab stop.

Where it lives matters: NodeCard's shell IS a `<button>`, and a button inside
a button is invalid HTML — the constraint that put this control in the toolbar
originally. So media items now render through a small wrapper (`GraphMediaItem`)
that carries the sizing and the hover group, with NodeCard filling it and the
trigger as a SIBLING. Being outside that button also means a press here never
reaches the card's drag wiring.

`tabIndex` follows the surface's ROVING value rather than a flat 0: a
virtualized strip mounts dozens of cards, and a fixed tab stop each would put
dozens in the tab order. Roving keeps the surface at one stop and this adds
exactly one more, on the card the user is actually on — so Tab from the card
lands on its trigger, and Enter opens the view.

The open state changed shape with it: the context named a boolean mode paired
with "whatever is selected", which only worked because the single trigger was
global. It now names WHICH item is open (`openId`), because a card can be
pressed without being the selection. Pressing the trigger also selects the
card, so the board's selection-scoped readouts agree with the view.

Acceptance criteria:

- Hidden at rest; revealed by hovering the card or focusing anything in it.
- Reachable by keyboard, one extra tab stop, on the roving card only.
- Opens the details view for THAT item, and selects it.
- The toolbar button is gone.

E2E covers idle → hover → away → focus opacity, the Tab-then-Enter path, and
that pressing it selects. The hover assertions must run BEFORE any click:
clicking a card focuses it, and focus legitimately reveals the trigger, so a
click first makes the idle state untestable. (The Browser pane cannot prove
this one — its synthetic mouse doesn't drive CSS `:hover`; Playwright's real
input does.)

## PL11-001 — Lighter icon strokes, white logo

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `timeline-sidebar.tsx`
- Screenshot: Not captured

At 28px the rail's glyphs carried too much stroke — lucide's default 2 reads
heavy once the icon is that big. Every rail glyph is now 1.5.

Set in CSS (`[stroke-width:1.5]` on the shared glyph class) rather than as a
prop on each icon: `stroke-width` is an INHERITED SVG property, so one class
covers every lucide icon the rail renders. The two composed folder icons keep
their own explicit widths — a presentation attribute on an element beats an
inherited value — so those were lightened by hand: the folder to 1.5, and
their corner badges to 1.9 (a little heavier, because at 16px inside a 24px
badge 1.5 disappears).

The logo's "SW" is white rather than zinc-400, with the hover a step down
instead of up.

Acceptance criteria:

- Every rail glyph computes to 1.5px stroke.
- The badge marks stay legible at their size.
- The logo renders pure white.

Verified live: `getComputedStyle(svg).strokeWidth` is 1.5px on the rail's
lucide glyphs (their `stroke-width` ATTRIBUTE is still 2 — the CSS wins),
1.5px on the folders, 1.9px on the badges, and the logo computes to
rgb(255, 255, 255).
