# Punch List 11

## PL11-003 — The header says whether the work is saved

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `lib/graph-documents-gateway.ts`, `graph-save-status.tsx` (new),
  `graph-board.tsx`
- Screenshot: Not captured

The app autosaves on a 900ms debounce and said nothing about it — the only
readout was a dev-gated panel behind `?dev`. That gap has teeth: undo history
lives in memory, so a reload ends it, and an autosaved mistake the user never
saw commit has no path back.

The gateway now exposes `saveState()` — pending (waiting out the debounce),
inFlight (in the batch being sent), lastSavedAt, error — and notifies when a
batch starts and settles, which it did not do before. Three states and no
more: `Saving…`, `Saved` (~2.6s), and `Not saved` with the error on its
tooltip.

It lives in the header's CENTRE slot and takes it over while it has something
to say, handing it back to the clip/duration readout when it doesn't — one
slot, whichever fact matters more at that moment. A total you can re-read at
any time loses to "your last edit isn't on the server yet". Nothing shows
before the session's first write, and there is no permanent resting "Saved":
chrome that never changes says nothing.

TRAP: `saveState()` first returned a fresh object per call, and
`useSyncExternalStore` compares snapshots by IDENTITY — so it re-rendered
forever and React tore the tree down. The board stopped rendering entirely and
every e2e using it timed out waiting for a card. The getter now caches its
snapshot and re-allocates only when a field actually changes.

Acceptance criteria:

- No indicator before the first write of a session.
- An edit shows `Saving…`, then `Saved` once the batch lands, then the centre
  slot returns to the clip/duration readout.
- A failure says so, carries the reason, and holds the slot.

## PL11-004 — A clip's name is `title`, and only shows when authored

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `packages/timeline-model/types.ts`,
  `packages/timeline-domain/src/adapter.ts`, `graph-persistence.tsx`,
  `graph-item-content.tsx`
- Screenshot: Not captured

PL10-010 wrote renames into `alt`, which was two problems in one: it rewrote
the accessibility description, and it left no way to tell a name a person
chose from a filename the import supplied.

`title` is now its own optional field on the clip, absent until someone types
one. `alt` goes back to being the derived description and survives renaming.
The node's `name` reads `title ?? alt`, so aria labels, drag ghosts and
announcements show the best available name; the CARD reads `detail.title`
directly, so it shows a label only when one was authored.

That absence is the point. Every clip has an `alt`, so a card rendering "the
name" renders something for all of them — and two thousand machine-named
clips read as a rename backlog. Unnamed cards stay bare; named ones look
deliberate.

What names are FOR here, from the user: similar-looking clips (ten close-ups
of one actor, cut from ten different takes) are indistinguishable by
thumbnail and carry no mechanical discriminator — each is 0→N of its own
source, so in/out says nothing. A title is the only thing that can say which
moment it is.

Acceptance criteria:

- Renaming writes `title` and leaves `alt` untouched.
- A card shows a name only when `title` is set.
- The details view still shows the best name, and renaming round-trips
  through a reload.

Rejected on the way: positional suffixes for naming a run ("Jake reacts 1…4").
Reorder is free in this app, so the numbers would start lying the moment
anyone moved a clip — a name that lies is worse than no name.

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
