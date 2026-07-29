# Punch List 11

## PL11-012 — Collections get a details view too

- Status: Complete
- Area: `graph-collection-details.tsx` (new), `graph-item-details-modal.tsx`,
  `graph-item-content.tsx`
- Screenshot: Not captured

The trigger and the view now serve both card kinds. What a collection's view
is NOT: a second timeline view — drilling in already answers "what is in
here". What it IS: the questions you would otherwise drill in and come back
out to ask — how much is inside, how long it runs, whether it is even loaded
— plus a rename, and a button to go in.

The hero is its contents, because a timeline's identity is its footage: the
card morphs into a larger version of the frames it was already showing. Live
numbers once hydrated, the stored summary for a placeholder — the same rule
the card follows, so the two can never disagree.

Scoped undo widened with it: a collection's undoable acts are renames and
disable toggles, not trims, so the gate now matches `update-media`,
`rename-node` and a single-node `set-node-disabled` against this item.
Structural commands name a parent and a set of moved nodes rather than "this
item", so they stay out of reach — which is the point of scoping.

REGRESSION CAUGHT BY THE SUITE, worth remembering: the trigger's
`aria-label="Open item details"` collided with the collection card's own
`Open <name>` drill button under the tests' `/^Open /` matcher — seven tests
failed with strict-mode violations, not timeouts. Two buttons on one card
whose names both began "Open" was a labelling problem before it was a test
problem: the trigger now reads `Details for <name>`, which also stops a board
full of them all announcing the same thing.

## PL11-013 — The scrub readout moves above the playhead

- Status: Complete
- Area: `graph-preview.tsx`
- Screenshot: Not captured

The timestamp sat below the thumb, which is where the user's own hand is
during a drag. It reads above now.

PL9-007 had put it below for a real reason — the rails sit hard against the
sticky header and the surfaces clip vertically, so an upward label inside the
rail was simply cut off. The fix is therefore not a CSS flip: the readout is
portaled to the body and positioned `fixed` in VIEWPORT coordinates, read off
the thumb's rect each paint. Nothing clips it, and z-[70] lets it overlap the
header it may reach into.

Both rails (strip and grid) share the change. Proven fail-first: moving the
same label back below the thumb fails the new geometric assertion (readout
bottom must clear the thumb's top).

## PL11-009 — One duration vocabulary

- Status: Complete
- Area: `lib/format-duration.ts` (new), board, cards, ruler, details view
- Screenshot: Not captured

The same timeline read "52.9s" on a card, "1m 24s" in the header and "6:32" on
its parent, because four near-copies of one rule had drifted apart. Numbers
that change shape between neighbouring pixels stop feeling like measurements.

One module, two registers, and the split is deliberate rather than an
oversight:

- READING — `formatDuration`: "12.4s" under a minute, "1:23" / "1:02:03" past
  it. Rounded, and never more precision than the eye can use.
- EDITING — `formatSeconds`: "12.40s", always seconds, because an in-point of
  "1:02" is not something you can type back into a field.

Anything editable takes the editing form; everything else reads. The ruler
keeps its own entry point (`formatTick`) because whole-second ticks drop the
".0" — a column reading "1.0s 2.0s 3.0s" is noise.

Live after the change: header `2 clips · 7:31`, cards `52.9s` and `6:38`,
details view `29.47s of 52.77s`.

## PL11-010 — A floor under the type

- Status: Complete
- Area: the graph view's labels (28 occurrences across 8 files)
- Screenshot: Not captured

The rail had just gone to 28px glyphs while the board still ran 9px and 10px
labels on near-black — two extremes with no middle register. Everything below
11px came up to it; the view now renders at 11px and 12px only, and nothing
overflowed its pill (checked by measuring `scrollWidth` against `clientWidth`
for every leaf label on the board).

11px is a floor for GLANCEABLE metadata, not a target: the readouts that
matter (names, aggregates) already sit at 12px and up.

## PL11-011 — Hover-only affordances on touch

- Status: Complete
- Area: `graph-item-content.tsx`
- Screenshot: Not captured

The details trigger hid itself until its card was hovered — which on a touch
device means it hides forever, and it is the only way into the details view.
The HIDING is now gated on hover existing at all
(`[@media(hover:hover)]:opacity-0`): visible by default, hidden only where a
pointer can reveal it. Busy beats unreachable.

Audited the rest rather than assuming: the breadcrumb drop zones are
drag-state-driven, the sidebar's tooltip labels are supplementary to buttons
that are always visible and tappable, and the collection call-out is a
hover-triggered flourish that simply never fires without a pointer. The
trigger was the only control a touch user could not reach.

TEST NOTE: `Emulation.setEmulatedMedia` with a `hover: none` feature leaves
`(hover: hover)` matching in this Chromium — it would have proved nothing.
The test opens a real `hasTouch` context instead, asserts
`matchMedia("(hover: none)")` first, and taps the trigger.

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

## PL11-014 — The breadcrumb stops waiting for the server

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-view-chrome.tsx`, `graph-navigation.tsx`
- Screenshot: Not captured

Reported as "a big delay before the new content shows" when clicking a crumb —
about a second and a half.

The trail was the last navigation in the app still relying on a bare
`next/link`. A Link cannot repaint the board until the App Router commits the
new pathname, and that commit waits on an RSC request the board needs nothing
from: the graph is already in memory, and the page segment only PRIMES
documents the client can fetch itself. Every other way to change focus — a
folder card, "Open this timeline", the O key — goes through `openTimeline`,
which publishes the destination before it pushes. The crumbs never got it.

Measured in dev, where that round trip is local and so as cheap as it will
ever be:

| Cold navigation | First feedback | Fully settled |
| --- | --- | --- |
| Drill in | 20ms | 530ms |
| Breadcrumb up (before) | 83ms | 878ms |
| Breadcrumb up (after) | 20ms | — |

The signature was that the crumb's content change and its URL change landed on
the SAME millisecond, four times out of four (53.6, 67.2, 94.8, 105.1) — the
view was not working, it was waiting. The hydration tail is shared by both
directions and is not what this fixes; the dead window at the front is. In
production that window is a network hop, and a control that does nothing at
all for a few hundred milliseconds reads as broken rather than slow.

All three link kinds route through `openTimeline` now: the ancestor crumbs,
the folded ones in the overflow menu, and the back arrow — except at the root,
where "up" leaves for the projects page, a genuine document load with nothing
to be optimistic about.

They stay real anchors. The handler claims ONLY the plain left click, so
modified and middle clicks still open a tab or a window, and `openTimeline`
now returns whether it took the navigation: a crumb whose parent chain does
not reach this project hands the click back to the browser instead of eating
it.

Acceptance criteria:

- A crumb click repaints the board without a server round trip.
- Ctrl/Cmd/Shift click still opens a new tab or window.
- Back/Forward still reconcile the board with the URL.

Verified live: the cold crumb hop repaints at 20.5ms (was 82.8ms), with the
URL committing behind it and the board agreeing once it lands. Dispatched
clicks confirm `defaultPrevented` is true for a plain click and false for
ctrl/meta/shift. Back returns to the previous focus with URL, crumb and card
count in agreement.

Covered by "a breadcrumb moves the board without waiting for the server",
which stalls every `_rsc=` request and requires the board to move anyway —
asserting the mechanism rather than a stopwatch, since a timing budget would
be flaky and would not fail on a fast local server. Proven fail-first, but
only on the SECOND attempt: removing `preventDefault` left the test passing,
because `openTimeline` still ran and the optimism survived. The honest revert
is removing the `onClick` altogether, and that fails.

## PL11-015 — The e2e "load flake" was oversubscription

- Status: Complete
- Area: `playwright.config.ts`
- Screenshot: Not captured

The graph-view suite had a long-standing reputation: 1-4 tests time out per
full run, always green in isolation, so the failures got waved through as
"flakes under parallel load". They were not random. They were the predictable
result of a budget that had quietly run out.

Diagnosis, from the JSON reporter rather than the summary line: every failure
was a TEST TIMEOUT at 30000ms — never an assertion — and they landed mid-run
(+49s, +93s of a 136s run), not at the start, so this was steady-state
contention and not first-hit compilation. The number that explained it: the
MEDIAN test took 15.3s against that 30s budget. The suite was running at a
2x margin on the median, so any test heavier than typical lost the race. Which
tests drew the short straw varied per run; that is what made it look like luck.

The cause is that Playwright defaults `workers` to half the core count — 14 on
this machine — while every test in both projects loads pages from ONE dev
server process. The bottleneck was never the CPU, so those extra workers
bought queueing rather than parallelism.

Measured over 101 tests:

| workers | failures | p50 | p90 | slowest | wall |
| --- | --- | --- | --- | --- | --- |
| 14 (default) | 2 | 15.3s | 19.1s | 35.1s | 136.2s |
| 6 | 0 | 5.8s | 8.4s | 13.0s | 101.8s |

Fewer workers is faster in wall clock AND removes the failures — no tradeoff
to weigh, the oversubscription was costing time as well as reliability. The
cap is a fixed 6 rather than a fraction of the cores on purpose: the shared
resource it is protecting does not scale with this machine.

A second, quieter bug surfaced while reading the config. `navigationTimeout`
was 60s against the default 30s per-test timeout, so a navigation was always
killed by the test budget long before reaching its own limit — the "give cold
navigations room" comment described an intent that had never been in effect.
Now 60s per test with a 45s navigation allowance inside it. That is not a way
to let slow tests pass: with the worker cap the slowest test is 13s, so the
ceiling only ever catches a genuine hang.

No retries were added. Retries would have hidden this rather than fixed it.

Acceptance criteria:

- A full graph-view run passes without per-test annotation or re-runs.
- Wall clock does not regress.

Verified: three consecutive full runs, zero failures (p50 5.8/6.1/7.0s, max
13.0/13.6/22.7s, wall 101.8/110.4/122.5s) against the previous run's 2
timeouts at 136.2s.
