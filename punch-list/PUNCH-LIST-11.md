# Punch List 11

## PL11-005 — F2 renames a media card in place

- Status: Complete
- Area: `graph-item-content.tsx`, `graph-navigation.tsx`
- Screenshot: Not captured

Naming a run of similar clips should be arrow → F2 → type → Enter → arrow, not
a modal round-trip each time. `OpenKeyBoundary`'s F2 now claims media as well
as collections, and the media card renders the same `InlineNameEditor` the
collection card, breadcrumb and sub-row share — as a SIBLING of NodeCard,
because that shell is a `<button>` and an `<input>` inside it is invalid
content. The wrapper added in PL11-002 is what makes the sibling possible.

Seeded with the authored `title` (not the filename), so re-naming edits what
the user wrote instead of making them clear a machine name first.

Known gap: an empty value is a no-op, so a title cannot be UNSET once given.

## PL11-006 — Typed in/out points

- Status: Complete
- Area: `graph-item-details-modal.tsx`
- Screenshot: Not captured

A pixel is worth ~0.11s in the details view and more on the board, so exact
edges were unreachable by pointer — restoring a clip to a known duration took
me a dozen attempts and never landed closer than 0.04s. The details view now
takes numbers.

Each field commits on blur or Enter as one `update-media` — the same command
the grips dispatch, so undo, the live channel and the write path behave
identically. Escape reverts the field. Out-of-range values are CLAMPED rather
than refused: an out point before the in point is a typo, and snapping is
faster to correct than an error message. A 0.05s floor stops a stray keystroke
trimming a clip to nothing.

## PL11-007 — The shortcuts sheet

- Status: Complete
- Area: `graph-shortcuts.tsx` (new), `graph-board.tsx`
- Screenshot: Not captured

Hold-to-drag, O, F2, the whole Alt layer, and (until PL11-003) no keyboard
undo at all — none of it was written down anywhere a user could reach. `?`
opens a sheet; the board menu has an entry for anyone who never tries the key.

Every row was verified against the handler that implements it — the app keys
in `graph-item-actions`, the board keys in `OpenKeyBoundary`, the card grammar
in the package's `use-keyboard-controller` — rather than written from memory.
A shortcuts sheet that lies is worse than none.

`?` is matched as a CHARACTER (it is Shift+/ on most layouts) and never fires
while typing.

## PL11-008 — Undo survives a reload

- Status: Complete
- Area: `packages/ui/dnd-collections/react/collections-store.ts`,
  `graph-history-persistence.tsx` (new), `graph-timeline-view.tsx`
- Screenshot: Not captured

The app autosaves and history lived only in memory, so a refresh made every
committed mistake permanent — the trash covered deletes, nothing covered
trims, renames or moves. I hit this myself repeatedly while restoring demo
data, before the demo project turned out to be scratch.

Patches are serializable by design ("this log doubles as a persistence
journal"), so the stack is simply written down: the store gained
`restoreHistory(entries)`, and an app-side bridge mirrors `historyEntries` to
sessionStorage keyed by the boot session, restoring once on mount.

Three decisions worth keeping:

- **sessionStorage, not local**: a reload is the case this exists for. A stack
  from days ago, built against a graph other sessions have since changed, is a
  liability rather than a safety net.
- **Undo only, never redo**: redo means "put back what I just took away", and
  after a reload there is no "just".
- **No validation on restore**: `undo` already verifies each entry against the
  live graph and drops the unreachable side, so a stale entry is refused when
  reached instead of corrupting anything. Bounded at 50 entries / 512KB.

Proven fail-first: with the bridge unmounted, a trim survives the reload and
Ctrl+Z does nothing — the field still reads 2.00 where it should read 0.00.

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
