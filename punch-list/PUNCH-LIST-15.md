# Punch List 15

Captured 2026-08-24 from a spoken walkthrough. Items are added as they are
dictated; each is Not started until it is worked.

## PL15-001 — Square off the left edge of the active tile's pill

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `components/timeline/sidebar-icon-styles.ts`
  (`SIDEBAR_ICON_BASE`, `SIDEBAR_ICON_PRESSED`)
- Screenshot: Not captured

The rail's active state is two layers: a blue indicator bar riding the rail's
left boundary (`after:left-0 after:w-[3px] after:bg-sky-300`) over a lifted
gray pill inset from the tile box (`before:inset-2 before:rounded-2xl`,
`before:bg-zinc-800`). The bar already says "you are here" as a POSITION.

Because the bar is doing that job, the pill should not also round away from
the rail's edge. Its LEFT corners go to 90°; its right corners stay `2xl` as
they are. A pill rounded on all four sides reads as a free-floating button
that happens to sit near a line; squared on the left it reads as one shape
anchored to the edge the bar marks.

The rounding is currently written once, on the shared base
(`before:rounded-2xl` in `SIDEBAR_ICON_BASE`), so this is a change to the
class every rail tile wears, not a per-item override.

Acceptance criteria:

- On the rail, the active tile's gray fill has square left corners and `2xl`
  right corners.
- The blue indicator bar is unchanged — same position, width, height and color.
- The glyph does not move, in either rail state (see the note on `RAIL_CLASS`:
  geometry must not key off `rail-open`).
- The board-options trigger the graph portals out wearing `SIDEBAR_ICON_BASE`
  is not on `.rail`, so it keeps the fully-rounded pill.

**Two things to settle when this is worked:**

- **Active only, or every tile?** The fill is on the shared base; the
  `zinc-800` value is the pressed state, but idle tiles carry a fainter fill
  (`before:bg-zinc-900/40`) through the same rounded box. Squaring only the
  active one means the pill changes SHAPE on activation, not just color.
  Squaring all of them keeps one shape and lets the bar alone carry the state.
- **Does the pill still sit inset from the left?** As spoken this is a corner
  change only, so `inset-2` holds and the squared edge stops 8px short of the
  bar with a gap between them. The alternative — running the fill flush to
  `left-0` so the bar sits directly on it — is a different look and was not
  asked for. Default to the corner change alone; check it on screen before
  going further.

## PL15-002 — Drop "Load project from file" from the board's `⋮`

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `components/graph-view/graph-project-menu.tsx`,
  `components/graph-view/graph-project-menu.stories.tsx`
- Screenshot: Not captured

The `⋮` beside Select in the board's top row holds two items: "Export
project…" and "Load project from file…". Load comes out. It already lives on
the projects page as the `LoadProjectButton`, and that is where an action on
the project SET belongs — loading replaces the whole offline board, so it is a
library verb that happens to have been reachable from inside one.

Export stays. It is genuinely a board action: it exports the project you have
open.

**This reverses a decision the menu documents.** `graph-project-menu.tsx` says
load "stays here as well because deciding to swap projects usually happens
while looking at one." That was the argument for two homes; the call now is
one home, on the library page. Worth knowing it was deliberate rather than
left over — the comment should go with the code rather than be left standing
as a rationale for something that is no longer there.

Nothing about the loading path itself changes: `loadProjectFromFile`, the
hidden file input, the busy state and the toast-reported failures all stay,
reached from the library button.

Acceptance criteria:

- The board's `⋮` offers "Export project…" and nothing else.
- Loading a project from a file still works from the projects page, unchanged.
- The hidden `[data-project-import-input]` and the `loadable` /
  `process.env.NODE_ENV` dev-only guard leave the board menu with the item —
  the library button carries its own copy of both.
- No dead imports left behind (`loadProjectFromFile`, `useRef`, `useState` are
  all there only for load).

**Coverage to relocate, not delete:** three of the four stories in
`graph-project-menu.stories.tsx` assert on load — `Open` checks the item is
listed, and `LoadRefused` and `LoadNotJson` drive a file through the input and
assert the error toasts. Those last two cover `loadProjectFromFile`'s failure
modes, which are still live code; they belong on the library button's own
stories now. Deleting them along with the menu item would quietly drop the
only coverage of a bad-JSON load.

**One thing to settle when this is worked:** with load gone the menu has a
single item under a "Project" label. A `⋮` that opens to reveal one thing is a
button with an extra click in front of it. Either it stays a menu because more
project verbs are coming, or Export becomes a direct control in the row. Look
at it once the item is out before deciding.

## PL15-003 — The strip opens in Collections, not flat

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph?surface=strip
- Area: `components/graph-view/graph-timeline-view.tsx` (`flatOn`),
  `components/graph-view/graph-board.tsx` (the `Collections` `HeaderToggle`)
- Screenshot: Not captured

The strip's Collections toggle — the `Layers` control just past the Media add
tool — is off when the strip opens. It should be ON: arriving in strip layout
shows the run grouped into its collections, and going flat is the thing you
choose.

Two lines carry the default, and both have to flip or the change only half
lands:

- `useState(initialSurface === "strip")` (`graph-timeline-view.tsx:293`) — the
  first arrival.
- `setFlatOn(surface === "strip")` in the surface-change block below it — every
  LATER arrival. It exists so "the strip is the same on every arrival", so
  leaving it would make grid → strip re-flatten a board that opened grouped.

**The reason this is worth doing, beyond preference:** flat mode refuses
`move-nodes` (see `commandPolicy`), so as it stands the strip opens with
drag-to-reorder OFF and nothing on screen says why. Opening in Collections
means the strip is reorderable on arrival, and flat becomes an explicit
trade you make.

Acceptance criteria:

- Opening strip layout shows collections, with the `Layers` toggle lit.
- Switching grid → strip → grid → strip still lands in Collections each time.
- Dragging to reorder works on arrival in strip.
- Grid is untouched (it has no flat mode; the toggle is strip-only).

**Two consequences to look at on screen before calling it done:**

- **The control is now lit on arrival, which its own comment argues against.**
  `active={!flatOn}` was written inverted precisely so the strip would not
  "have a control that is lit on arrival and whose job is to turn itself off".
  Flipping the default recreates that shape. Either the toggle re-orients to
  offer the flat run (off on arrival, `active={flatOn}`, labelled for flat), or
  it stays a lit Collections toggle and that comment gets rewritten to say why
  that is now right. Do not leave the comment standing against the code.
- **The time-axis group thins on arrival.** Ruler and waveform mount only
  behind `flatOn`, along with the fence that opens their group — so the strip
  now opens with the zoom slider alone on the right. Nothing breaks (the
  flat-off watcher already turns both off), but the row looks different on
  first sight and that is the change people will notice second.

## PL15-004 — The strip's trim handle collar goes white

- Status: Complete, CONFIRMED BY THE OWNER in the app. The open question was
  whether an armed handle still reads as armed once the collar is white at rest
  — arming has no colour left to change, so the grip carries it alone (`h-5` to
  full height, `black/45` to `black/70`). Checked on a real strip: it reads
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph?surface=strip
- Area: `components/graph-view/graph-card-trim.tsx` (`GraphTrimHandle`)
- Screenshot: Not captured

The trim handle is two parts: the 8px collar around the edge, and the grip
line down the middle of it. At rest the collar is `bg-zinc-400/45` — grey —
and only goes white (`bg-white/95`) once the press has settled and the handle
is armed. Make the collar white at rest, matching the white the handle already
uses.

**This reverses "QUIET AT REST", which the file argues for at length.** The
collar was a solid `white/85` and was deliberately dropped to grey: grey holds
against a bright frame as well as a dark one, and blue and amber were already
spoken for as selection and window. That reasoning is on the record; the call
now is that the handle reads as a handle at rest. The comment block goes with
the change rather than being left contradicting the code.

Acceptance criteria:

- A strip clip's trim collar is white at rest, on both edges.
- It still holds against a bright frame — check on a white or blown-out clip,
  not only on a dark one. That is the case grey was chosen for.
- The grip line inside is unchanged.
- Grid is unaffected if it draws the handle differently; strip is what was
  asked for.

**The thing this costs, and the way out:** arming currently announces itself
by the collar going grey → white. With the collar already white there is no
colour left to change, and arming matters — the same press pans the strip, so
the handle has one moment to say "the next pull edits". It is not lost: the
GRIP already changes on arm, `h-5 → h-full` and `bg-black/45 → bg-black/70`,
which is a geometry and ink change inside the handle. Confirm by eye that the
grip alone reads as armed. If it does not, the armed state needs its own
value — a brighter white, or the grip going full black — rather than the
collar going back to grey.

**One thing to confirm:** "the same white as the other trim handle colors" is
read here as `white/95`, the value already in this file for the armed state.
If it meant the `white/85` the collar used to be, it is a one-token change —
say which and it is done either way.

## PL15-005 — Changing the view count keeps the panels it already has

- Status: Complete — the cause was NOT the container query on CONTENT, it was
  the one on the neighbour's HEIGHT: crossing 30rem swapped a definite value
  for `h-auto`, which cannot be interpolated, so heights jumped in one frame
  while widths eased. Fixing it also fixed a latent bug — at five-up every
  neighbour was falling back to fitting its own picture, the exact "four
  neighbours at four different heights" the fixed height was introduced to
  prevent.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details, then use the 3 / 5 control)
- Area: `components/graph-view/graph-item-details-modal.tsx`,
  `components/graph-view/graph-item-details-panel.tsx`,
  `components/graph-view/graph-item-details-view-count.ts`
- Screenshot: Not captured

Switching 3 → 5 currently plays as a full content replacement: the three
panels animate off, then five animate on. Going 5 → 3 does the same in
reverse. That is the wrong event. Changing the count does not change what you
are looking at — the subject is the same clip and its neighbours are the same
clips — so nothing that is staying should leave.

What it should do:

- **3 → 5.** The three panels on screen stay put and SHRINK into their new
  width; two more grow in at the edges. Nothing else moves as a new thing.
- **5 → 3.** The two outermost panels leave; the remaining three GROW into
  their new width, in place.
- The subject stays the subject throughout, at the centre, never re-entering.

Only the entering and leaving panels are an appearance or a departure.
Everything else is a resize.

Acceptance criteria:

- Through a 3 → 5 step, the three panels visible before the step are the same
  DOM elements after it, with the same pictures, and their width transitions
  rather than restarting.
- Through a 5 → 3 step, the three that survive never fade out and back in.
- Entering panels arrive at the edges; leaving panels leave from the edges.
- The subject panel does not flicker, re-seek, or lose its frame at any point.
- One clock, as the rest of the step already is — `DETAILS_STEP_MS` /
  `DETAILS_STEP_EASING` from `graph-details-motion.ts`, not a new duration.

**What the structure already gets right, so the fix is not where it looks.**
The row renders EVERY id in the flat order, keyed by `id`, and mounts real
panels within `MOUNTED_RADIUS = floor(viewCount / 2) + 1`. Working it through:
at 3, visible is centre±1 and mounted is centre±2; at 5, visible is centre±2
and mounted is centre±3. So the two panels that become visible on a 3 → 5 step
were ALREADY mounted as real panels — they were the off-screen spares — and on
5 → 3 the two that leave stay mounted. In neither direction is a panel that is
visible on either side of the step mounted or unmounted. React is not throwing
these away, so "it replaces everything" is not a keying or mounting fault.

**Where it most likely IS, to confirm before fixing.** A panel decides how much
of itself to draw from a CONTAINER QUERY on its own width — a narrow panel is
"a frame and a name", a wide one carries its controls, and the neighbours'
fixed height is a second rule beside it. Changing the count changes the
neighbour width, which walks those panels across a query threshold, so their
CONTENTS switch on a boundary while their box eases. Content appearing and
disappearing on a threshold, on five panels at once, is what a replacement
looks like even when the elements are the same ones.

Confirm that on screen before changing anything: step 3 → 5 slowly and watch
whether the pictures persist while the controls pop, or whether the pictures
go too. Those are different bugs and only one of them is the container query.

## PL15-006 — The bar's settings move behind a gear; reach stays out

- Status: Complete, CONFIRMED BY THE OWNER in the app. SHIPPED BROKEN FIRST:
  the menu portals to `body` and so rendered behind the modal's `z-[80]` scrim
  at its default `z-50`. Reported from the app, not caught by the stories,
  which drove the menu's contents without ever asking whether they were
  visible. Fixed, asserted as a computed z-index, and now seen working — and the gear is deliberately NOT gated on `md:` like the
  groups it replaces, so frames/card/fit are reachable on a narrow viewport
  for the first time. The left grid cell is kept as an empty spacer: it is
  what centres the transport.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details — the controls row under the bar)
- Area: `components/graph-view/graph-seam-strip-bar.tsx` (the controls row,
  `settingsLeft` / `settingsRight`, the `fit` group),
  `components/graph-view/graph-item-details-modal.tsx` (which builds them),
  `components/graph-view/graph-item-details-modal.stories.tsx`
- Screenshot: Not captured

The bar's controls row carries four segmented groups. Three of them go into a
popup behind a settings icon at the FAR RIGHT of the row; the fourth stays
exactly where it is.

Into the menu:

- **frames** — `OFF · COVER · STRIP` (`data-details-bar-frames`)
- **card** — `FOLLOW · PIN` (`data-details-bar-card`)
- **fit** — `CLIP · ALL` (`data-seam-fit`)

Staying visible, unchanged:

- **reach** — `5 · 10 · 20 · ALL` (`data-details-bar-reach`)

The gear sits to the RIGHT of reach, at the end of the row. The 3 · 5 view
count in the modal's bottom-right corner is a different control in a different
place and is not part of this.

Acceptance criteria:

- A settings icon is the last thing in the bar's controls row, after reach.
- It opens a menu holding the frames, card and fit groups, each still labelled
  and each still a one-of-N group with the same options.
- Reach stays a visible segmented control in the row, in its current position.
- Every setting keeps its current behaviour and its current default.
- The menu is non-modal, like the other menus in this header — Radix's modal
  default puts `pointer-events: none` on the body and stops the trigger
  receiving the click that closes its own menu (the project `⋮` documents
  this).

**One behaviour that must survive the move.** The frames group is three
segments over TWO stored settings: `OFF` sets `shown: false` and deliberately
leaves `style` alone, so switching frames off and back on returns to the kind
you were using. That is why the two are stored apart. It is easy to lose when
the group is rebuilt inside a menu.

**Test handles go behind a trigger.** `graph-item-details-modal.stories.tsx`
reaches for these groups nine times, and its `play` functions click the
segments directly. Every one of those now needs the menu opened first. There
is no e2e reference to the three attributes, so this is contained to the
stories — but they are the interaction suite, and a handle that no longer
resolves fails as a timeout rather than an assertion.

**One thing this could fix for free, and one decision it forces.** The `fit`
group and `settingsRight` are both `hidden md:flex`, and `settingsLeft` is
gated the same way — so on a narrow viewport these settings are not merely
crowded, they are unreachable. A menu can carry them at every width. Whether
to take that (drop the `md:` gate on the gear) or keep the current
small-screen behaviour is a real choice: it was not asked for, and doing it
silently would change what the modal offers on a phone. Default to
like-for-like, and say so.

## PL15-007 — The account avatar shows a broken image

- Status: Complete
- URL: http://localhost:3000/ (the rail's Account tile, bottom of the sidebar)
- Area: `components/timeline/timeline-sidebar.tsx` (lines ~1236 and ~1273)
- Screenshot: Not captured

The Account tile at the bottom of the rail draws the browser's broken-image
glyph instead of a face.

The cause is a gap in the fallback, not a missing fallback. The tile branches
on `user?.picture`: absent, it draws the initial letter in a circle
(`initialOf`); present, it draws `<img src={user.picture}>` — and there is
nothing behind that `<img>` if the request FAILS. A URL that exists but does
not load takes the picture branch and then has nothing to fall back to, which
is exactly the broken glyph.

**Two places, same shape.** The rail tile at ~1236 and the profile popover at
~1273 both branch this way. `initialOf` exists precisely because the ternary
was duplicated; the error handling has to land in both or the popover keeps
the broken glyph after the tile is fixed.

**Is it dev-only?** Not in kind. `picture` comes from the Firebase ID token's
`picture` claim (`lib/firebase-auth-session.ts`), so it is a real
`googleusercontent` URL, not a dev fixture — and the missing error path is
there in production too. Whether the URL is failing only on localhost is a
separate question the code cannot answer: check the actual request (a 429 from
Google's avatar host, a referrer-policy block, or an extension blocking it are
all ordinary causes, and they all land as this same glyph). Worth knowing
which, because a 429 means it will intermittently break for real users.

Acceptance criteria:

- An avatar that fails to load falls back to the initial-letter circle, in
  both the rail tile and the profile popover.
- The fallback looks identical to the no-picture case — same size, border and
  hover treatment — so a failed load is indistinguishable from an account with
  no photo.
- No layout shift when the fallback swaps in.
- An account WITH a working picture is unchanged.
- The `relative` class stays on the image: the tile's pill is an absolute
  `::before` and would otherwise paint a 40% black veil over the face.

## PL15-008 — The preview's volume becomes an icon that reveals its slider

- Status: Complete — MUTE WAS KEPT as a press, inside the popover beside the
  slider, rather than becoming "drag to zero". Losing a one-press action to
  gain a reveal was the wrong trade. The divider's left 36px stops being drag
  target; three e2e interaction points moved off that end, which is only
  honest because the rest of a full-width divider remains.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (the workbench preview, with the pane open)
- Area: `packages/ui/timeline/viewport/workbench-display-surface.tsx`
  (`WorkbenchAudioControls`, `WorkbenchDividerTransport`),
  `apps/timeline-gstudio001/tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

Today the preview's audio control is a mute button and a 64px slider, always
both, in a pill over the bottom-left of the picture. It becomes:

- **The audio icon alone.** No slider until asked for.
- **Click reveals the slider.** Click the icon again and it goes away; click
  anywhere outside it and it goes away.
- **The icon sits on the DIVIDER, at the far left** — the band that already
  carries the transport, with the icon at the opposite end from the clock.

Acceptance criteria:

- At rest the control is one icon; the slider is not in the layout.
- Clicking the icon shows the slider; clicking it again hides it; a click
  outside hides it. Escape hides it too, with one explicit owner for the
  dismiss — see the note below.
- The slider still sets volume live while dragging, and the icon still shows
  the silent state (`VolumeX` when muted or at zero).
- The `audioBlocked` state still says so — a preview that was refused sound
  for want of a user gesture must not read as merely quiet.
- Revealing the slider does not start or stop playback: the surface below
  toggles play on click, and these controls stop propagation for that reason.

**WHAT MUTE DOES NOW HAS TO BE DECIDED.** Click currently MUTES. If click
opens the slider instead, muting needs a home: either the icon toggles mute
and something else opens the slider, or the slider carries mute at its zero
end and the separate mute action goes away. As dictated the second is implied,
but it is a real loss — mute-and-restore is one press today and would become a
drag to zero and a drag back to a level you have to remember. Worth settling
before building.

**THE POSITION REVERSES A MEASURED DECISION, AND TWO E2E TESTS GUARD IT.**
The file says plainly: "Volume lives INSIDE the preview, not on the divider
beside play/pause. The divider is a resize handle first: its whole band is the
drag target, and parking a button at its left end quietly shrank that target —
the e2e that hovers the divider at x=20 caught it immediately."

That is not a stale comment. `graph-view.spec.ts` hovers the divider at
`x: 20` in TWO places — line 1737 (the divider's hover treatment) and line
2718 (the transport's placement). A `size-6` button at the far left covers
roughly x=8 to x=32, so it sits under both hover points and will intercept
them. Expect both to fail, and expect the failure to look like a hover that
simply stops working rather than like a moved button.

So this is not "move the icon and fix a selector". Either:

- the divider stays fully draggable THROUGH the icon — a pointerdown on it
  starts the resize and only a click without drag opens the slider, which is
  buildable but has to be got right or the icon eats resizes; or
- the divider's left end genuinely stops being drag target, in which case
  measure what band is left and say whether it is still a comfortable handle
  before moving the e2e hover points. Moving the test to suit the code is only
  honest if the answer to that is yes.

This was asked for directly, so it goes in as asked. The comment argues the
other way and the tests enforce it; both need updating deliberately, with the
reason written down, rather than being worked around.

**Where the slider appears** is unspecified and needs a decision: the divider
is a thin band, so an inline slider would either stretch it or be cramped. A
small popover above the icon, over the picture, is the likely answer — which
puts the slider back roughly where the whole control lives today.

## PL15-009 — Remove the paired-card jiggle

- Status: Complete — the jiggle is gone; the pairing signal is now the STATIC
  glow that already existed for reduced-motion users. Say if you wanted the
  signal gone entirely and it is a one-line follow-up.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (children timelines shown, hover a child row's folder)
- Area: `app/globals.css` (`collection-paired-callout`),
  `components/graph-view/graph-collection-hover.tsx`,
  `components/graph-view/graph-collection-card.tsx`,
  `components/graph-view/graph-sub-timelines.tsx`,
  `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

Hovering a child collection's folder icon makes that collection's card in the
grid or strip scale up and settle — a 320ms elastic pulse
(`collection-paired-callout`, `cubic-bezier(0.34, 1.56, 0.64, 1)`, out to 1.06
then under to 0.985 and back). It goes.

Acceptance criteria:

- Hovering a child row's folder does not animate the card above.
- Nothing else on the card animates in its place by accident — check a card
  that is also selected, disabled, or mid-FLIP.
- `prefers-reduced-motion` behaviour is unaffected (it already suppressed
  this).

**THE PAIRING SIGNAL DISAPPEARS ENTIRELY WITH IT, and that is worth a
decision.** The card gets two classes when called out — `is-called-out-card`
and `animate-collection-paired-callout` — and `is-called-out-card` has **no
CSS rule anywhere**. It exists purely as an e2e handle. So the animation is
not one of two signals, it is the only one: remove it and hovering a folder
does nothing visible at all.

That may be exactly what is wanted — the pairing is a nicety and the jiggle is
the thing that grates. But if the intent was "keep telling me which card this
is, just stop it bouncing", the replacement is a static treatment (a ring, a
lifted border) held while the pointer is on the row, and that is a different
change with different plumbing: the hold-past-leave machinery in
`graph-collection-hover.tsx` exists ONLY to let an animation finish, and a
static highlight wants the opposite — follow the pointer exactly, no hold.

Say which. Defaulting to a straight removal.

**What comes out if it is a straight removal:** the keyframes and the
`.animate-collection-paired-callout` rule (including its two
reduced-motion blocks), `COLLECTION_CALLOUT_KEYFRAMES_MS` /
`COLLECTION_CALLOUT_MS` and the hold timer they document, and — if nothing
replaces the signal — the whole `useCollectionHoverTarget` / channel path plus
the `onPointerEnter` / `onPointerLeave` on the folder button.

**Two e2e tests are built on this and both must go or be rewritten**
(`graph-view.spec.ts`): one at ~4876 that asserts the running animation is
named `collection-paired-callout` and that it reports `finished` rather than
`cancelled`, and one at ~5924 that asserts `.is-called-out-card` has count 1
and measures its box. Neither degrades gracefully — with the class gone they
fail as a locator that never resolves.

## PL15-010 — The whole child-timeline row opens it, not just the folder

- Status: Complete — the NAME is excluded (a rename's first click would
  otherwise expand the row and fire its hydration fetch); everything else in
  the header toggles. Hover moved with the click, so the card call-out lights
  from the same region that opens the row.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (children timelines shown)
- Area: `components/graph-view/graph-sub-timelines.tsx`
- Screenshot: Not captured

A child timeline's row header is a 20px folder button, a name, a clip count, a
status chip and a run of decorative frames — and only the folder button
expands it. The whole bar should.

Acceptance criteria:

- Clicking anywhere on the row header toggles the timeline open or closed.
- The folder glyph still toggles, and still shows open/closed state.
- The row reads as clickable — a pointer cursor and a hover treatment across
  the whole bar, not just under the folder.
- Keyboard: one control, reachable by Tab, with `aria-expanded` on it. Not two
  controls that do the same thing.

**Three things in the row already take a click, and each needs a rule:**

- **The name double-clicks to rename.** This is the real one. A single click
  that toggles means a rename double-click toggles TWICE — back to where it
  started — while the editor opens. Options: exclude the name from the
  clickable area, or delay the toggle past the double-click threshold (which
  makes every expand feel slow), or move rename onto an explicit control.
  Excluding the name is the cheap answer and costs the least, but the name is
  the biggest target on the bar and excluding it undercuts "the whole bar".
- **The rename editor is an `<input>` in that row.** While it is open, clicks
  inside it must not toggle anything.
- **The preview frames are `aria-hidden` and deliberately not focusable**, so
  that "the row's accessible surface is still exactly its toggle and its
  name". Making the row clickable must not turn them into a second tab stop.

**Do not wrap the row in a `<button>`.** It contains a button and, while
renaming, an `<input>` — nested interactive elements are invalid and break
keyboard behaviour. Put the click on the row's container and keep ONE
accessible control (most likely the folder button, or the folder-plus-name as
a single button with the badges outside it).

**If PL15-009 keeps a pairing signal**, its hover trigger currently sits on the
folder button alone. Whatever area becomes clickable should be the same area
that triggers the highlight, or the row will light a card from one region and
open it from another.

## PL15-011 — The child row's thumbnail mirrors a real collection card

- Status: Complete — SEE PL15-020: the placeholder half was briefly reverted
  on a wrong inference and has been restored, because reverting it did not fix
  the failing invariant either. Complete — the audio placeholder was carried across too, so a
  voice-takes collection no longer reads as empty in the tree and as audio on
  the board. The border is a RING: a border would have widened the box and
  pushed it off the column the negative margin exists to hold.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (children timelines shown — the thumbnail at the far right of a row header)
- Area: `components/graph-view/graph-sub-timelines.tsx`
  (`data-subtimeline-thumbs`), `components/graph-view/graph-collection-card.tsx`
  (`data-collection-mark`), `components/graph-view/graph-card-placeholders.tsx`
- Screenshot: Not captured

The thumbnail at the far right of a child timeline's row shows the
collection's frame, and nothing else. It should read as the same object as the
collection card it stands for:

- **The collection mark over the frame** — the `Layers` glyph on its dark
  disc, exactly as the card wears it, centred.
- **The mark when there is NO frame too**, over the dark gradient. On the card
  the mark is drawn whether or not there are frames, deliberately: "said once,
  and the same way, whether the card has frames behind it or nothing at all."
- **A slight border around the thumbnail**, on every row.

Acceptance criteria:

- A row whose collection has a frame shows that frame with the mark centred
  over it.
- A row whose collection has no frame shows the same dark gradient the card's
  empty state uses, with the mark centred over it.
- Every row's thumbnail carries a light border, framed or not.
- The frames still line up on one vertical column however deeply rows nest —
  the negative `marginRight` that cancels the ancestor panels' inset is
  load-bearing and a border must not push the column off it.
- The thumbnail stays `aria-hidden` and unfocusable; this is decoration, and
  the row's accessible surface is still its toggle and its name.

**THE ROW HAS NO GRADIENT TODAY — it has a flat tint.** Worth being exact,
because "keep using that" reads as "leave it alone" and the change is the
opposite. The row's box is `bg-zinc-950/60`, a flat dark wash that shows
through when no frame renders. The CARD's empty state is
`EmptyCollectionPlaceholder`: `linear-gradient(155deg, #27272a, #18181b,
#09090b)`. They look similar at 40px and are not the same thing. Mirroring the
card means ADOPTING that gradient here, from the shared placeholder rather
than by retyping the stops.

**The mark has to be resized, not reused as-is.** On the card it is a 40px
`Layers` (`h-10 w-10`) inside a disc with `p-2` — sized against a card. The
row's thumbnail is 40px tall and 72px wide in total, so the card's mark would
cover it completely. It needs its own scale while keeping the parts that make
it work: the disc behind the glyph (a bare glyph breaks up over a pale frame),
`bg-black/45` on the disc as a background alpha rather than `opacity` on the
wrapper, and the glyph's own half opacity so the frame reads through.

**One thing to decide:** the card's empty state is not one placeholder but
two — a collection that leads with audio gets the audio glyph instead of the
gradient, because "this is sound" is truer there than "this is empty"
(`leadsWithAudio`). Mirroring the card properly means carrying that here too.
Doing it is more faithful; skipping it means a voice-takes collection reads as
empty in the tree and as audio on the board. Recommend carrying it, since the
whole point of this item is that the two agree.

**Attribute reuse to watch.** If the row's mark reuses `data-collection-mark`,
selectors that assume one mark per card will start matching rows as well —
`graph-item-content.stories.tsx` queries it with `querySelector` in three
places. Either give the row's mark its own attribute or check those queries
are still scoped to a card. The e2e already reads `[data-subtimeline-thumbs]`
(`graph-view.spec.ts:1031`); confirm what it asserts before changing the box.

## PL15-012 — The drop zone goes dashed and grey

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (drag a file from the OS over the grid or the strip)
- Area: `components/graph-view/graph-native-drop-chrome.tsx`
  (`dropZoneClassName`)
- Screenshot: Not captured

While a drag is live, every eligible surface outlines itself and the one under
the pointer fills in. Both states are bright sky blue:

- armed — `bg-sky-400/[0.03] ring-sky-400/40`
- hovered — `bg-sky-400/10 ring-2 ring-sky-400`

It becomes a DASHED edge in a subdued grey, tint to match. The two states stay
two states — the surface under the pointer must still be plainly the one that
will take the drop — but the whole thing steps back.

Acceptance criteria:

- The eligible-surface edge is dashed and grey.
- The hovered surface is still unmistakably distinct from a merely eligible
  one, in grey.
- The tint is grey rather than blue, and stays subtle enough to read over both
  the grid's dark ground and a strip full of bright frames.
- Nothing about the box changes when the affordance arms — see below.

**A RING CANNOT BE DASHED, so this is not a value swap.** Tailwind's `ring-*`
is a box-shadow, and box-shadows have no dash. The layout-safe way to get a
dashed edge is `outline` with `outline-dashed` — an outline is painted outside
the box and, like a ring, does not participate in layout. A `border` would.

That matters more here than anywhere: this file's own rule is "Ring and
background only — nothing here may change the box, or arming the affordance
would reflow the strips mid-drag and move the very gaps being aimed at." A
dashed border would do exactly that — arm the affordance, reflow the strip,
and shift the gap the pointer is aiming at while it is aiming at it. Use
`outline`, and check `outline-offset` so the dash does not sit under the
adjacent card.

**The insertion bar stays blue, on purpose.** `DROP_INDICATOR_CLASS` is a
`bg-blue-500` line with a glow, and it answers a different question — not
"this surface will take it" but "it will land HERE". With the zone chrome
going grey that bar becomes the only colour in the drag, which is the right
outcome: the precise signal keeps the accent and the ambient one gives it up.
Not part of this item unless it looks wrong once the surround is grey.

**Scope is exactly two surfaces.** `dropZoneClassName` has two consumers,
`NativeDropGrid` and `NativeDropStrip` — the grid and the strip, and nothing
else. This is the OS-file drag chrome; in-app card drags use the insertion
indicator instead and are untouched.

**No test asserts these colours** — nothing in the e2e or the stories reads
the ring or its computed style — so this is safe to change on look alone. Judge
it against a strip of bright frames as well as an empty board: grey at 3%
opacity over a wall of pictures is close to invisible, and "subdued" must not
become "cannot tell it armed".

## PL15-013 — Count the real lines of code, per file, biggest first

- Status: Complete. `npm run audit:loc`; the run is in
  `punch-list/PUNCH-LIST-15-loc.txt`.

**The result, as of the end of this punch list: 432 files, 50,928 lines of
application code.** Full list in `punch-list/PUNCH-LIST-15-loc.txt`.

TESTS AND STORIES ARE EXCLUDED, on request and rightly. They were counted and
marked `T` at first, on the reasoning that a 3,000-line stories file is a
different fact about a codebase than a 3,000-line component. True — and exactly
why they do not belong in the same list: mixed in they dominated it. The single
largest file in the tree is the e2e suite at 5,525, two of the top three were
stories, and a list meant to show where the CODE is was mostly showing where
the tests are. `--tests` puts them back.

Excluding them by FILENAME was not enough. `tests/demo/foobar-demo.mjs` is 475
lines of harness and is none of `.test.`, `.spec.` or `.stories.`, so it sat
fifteenth among the application code. The rule is by name, by directory
(`tests/`, `e2e/`, `test-support/`, `fixtures/`) and by job (runner configs, a
stories helper). Maintenance scripts and the offline fixture STORE stay — those
are real code that happens to have "fixture" in the name.

For scale, with tests included it is 623 files and 96,235 lines, so coverage is
46% of this repo by line.

Comments are excluded throughout, and this repo comments heavily, so every
number is much smaller than the file looks: `graph-board.tsx` is 1,515 lines of
code in a file more than twice that.

**Do this LAST, after every OTHER item is complete** — including any added
after it, since numbering is the order they were dictated and not the order
they are worked. The counts are meant to describe the tree as it ends up, not
as it started.

Produce a list of every real source file with its count of actual code lines,
ordered highest first, showing the file name and where it lives as a path
relative to the repo root.

Counting rules, pinned down because the vagueness is what would make the
output useless:

- **Comments are not code.** Line comments, block comments, and JSDoc — a line
  inside a `/* … */` run counts as comment even though it carries no marker of
  its own. This repo's files are heavily commented by design, so this rule is
  most of what the number means.
- **Blank lines are not code.**
- **A line with code AND a trailing comment is code**, counted once.
- Real source only: `.ts`, `.tsx`, `.js`, `.mjs`, `.css`. Not JSON, markdown,
  lockfiles, or config data.
- **Excluded entirely:** `node_modules`, `.next` (including
  `.next/standalone`, which holds a full second copy of the app and would
  double every count), `dist`, build output, coverage, and anything generated.
- Tests and stories are real files and are counted — but reported so they can
  be told apart, since a 3,000-line stories file is a different fact about the
  codebase than a 3,000-line component.

**Write it as a script, not a one-off.** `scripts/find-unreachable-ui.mjs`
behind `npm run audit:ui` is the precedent, and this is the same kind of
thing — a question worth asking again after the next round of work rather than
a number produced once and pasted into a chat. `npm run audit:loc` or similar.

Acceptance criteria:

- One command produces the list.
- Ordered by code lines, descending.
- Each row shows the file and its repo-relative directory.
- A total at the end, and a count of files scanned.
- Re-running it after an edit changes the numbers — verify on one file rather
  than assuming.

**One thing assumed:** "relative to the root directory of this app" is read as
the REPO root (`packages/ui/...`, `apps/timeline-gstudio001/...`), since this
is a monorepo and a path relative to `apps/timeline-gstudio001` could not
name a file in `packages/`. Say if the app workspace alone was meant.

## PL15-014 — The bar's end stops get room, and a word

- Status: Complete — the gap is its own 40px constant and the word sits IN it,
  between the stop and the film. Check it panned hard to either end: the start
  stop is at a negative offset by construction and I could not clamp it (see
  the code note), so a very narrow track could still crop it.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details; set reach to `All` on a short collection so
  both ends are real ends)
- Area: `components/graph-view/graph-seam-lane.tsx` (`SeamEndCap`,
  `CAP_WIDTH_PX`), `components/graph-view/graph-seam-metrics.ts`
  (`BOX_INSET_PX`),
  `components/graph-view/graph-item-details-modal.stories.tsx`
- Screenshot: Not captured

At the very start and very end of the bar — and only where the window has
reached a REAL end rather than merely run out of boxes — a pale vertical mark
is drawn just outside the first and last box (`SeamEndCap`: 6px wide, a
gradient falling away from the film). Two changes:

- **More space between the mark and the strip.** It currently sits
  `BOX_INSET_PX` (2.5px) from the box, and that is on purpose: the same inset
  the gap between two boxes is made of, "so the stop sits at the distance the
  eye already reads as next thing along". Which is precisely the problem — at
  a clip's own gap it reads as another clip's edge rather than as the end of
  the film. It needs its own, larger inset.
- **A word.** Something naming it as the beginning or the end, rather than
  leaving a bare mark to be inferred.

Acceptance criteria:

- The start and end marks are separated from the first/last box by visibly
  more than the gap between two adjacent boxes.
- Each carries a short label saying which end it is.
- Neither is drawn when the window is merely cropped — the existing
  `atStart` / `atEnd` gate is what makes the mark mean anything and must not
  loosen.
- The gap is its own constant, not a reused `BOX_INSET_PX`. Sharing the number
  is what made the two read the same; sharing it with a multiplier would put
  the next reader back in the same place.

**Where the label can physically go, which needs checking first.** The start
cap is positioned at `atPx - CAP_WIDTH_PX - BOX_INSET_PX` — to the LEFT of the
first box. Push it further left and, when the bar is scrolled to its
beginning, it moves toward and possibly past x=0. A word is much wider than a
6px mark, so the start label is the one at risk of being clipped against the
track's left edge. Look at it scrolled hard to the start before choosing where
the text sits: beside the mark, above or below it, or inside the leading gap
if the strip has one to give.

**Do not put the label inside the cap's own element.** The story
`TheBarMarksTheEndsOfTheProject` asserts the cap's box against the boxes'
(`startCap.right <= first.left + 0.5`, `endCap.left >= last.right - 0.5`).
Those are RELATIONAL, so widening the gap passes unchanged — good. But adding
text inside `[data-seam-cap]` grows that element's rect and would break both
assertions for a reason that has nothing to do with what they are testing.
Give the label its own element, and keep `[data-seam-cap]` meaning the mark.

**One thing to decide:** the cap is `aria-hidden="true"` today, correctly — it
is a graphic restating what the boxes already say. A word is different: it is
content, and hiding readable text from assistive tech to keep an old attribute
is the wrong way round. Either the label is announced (and the mark stays
hidden beside it), or there is a reason it should not be. Choose deliberately
rather than inheriting the attribute.

## PL15-015 — A trim edge cannot be dragged into the middle

- Status: Complete as the MINIMUM WINDOW reading, at ONE QUANTUM (0.1s). It
  was 0.25s until `VirtualStrip.stories` failed asserting `0.10s / 10.00s` —
  a shipped, tested trim the floor had quietly made impossible, which is the
  exact risk this item warned about. The floor gave way rather than the test.
  A larger one is a single constant, but choose it against trims people
  actually make. The hard halfway stop is deliberately NOT
  built — it forbids legitimate trims. Say if that was what you meant; it is
  the same two lines.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a video clip's details — the trim strip with the draggable window)
- Area: `packages/ui/dnd-collections/react/trim-gesture.ts`
  (the windowed branch of the trim reducer)
- Screenshot: Not captured

In the details modal, the trim strip's window can have either edge dragged
deep into the clip — the start pulled to the middle and past it, the end
likewise. It should stop: an edge is constrained, not free to swallow the
clip.

**The mechanism, found.** The reducer clamps each edge only against the OTHER
edge:

```
trimInSeconds  = clamp(…, 0, fullDurationSeconds - trimOutSeconds)
trimOutSeconds = clamp(…, 0, fullDurationSeconds - trimInSeconds)
```

So the two can meet. The window has no MINIMUM — the clamp forbids crossing
and permits collapsing to zero, which is why an edge keeps travelling all the
way through the middle and out the far side. There is no floor anywhere else
either: `MAX_HANDLE_SHARE` only decides whether a handle is DRAWN on a short
clip, and does nothing to a drag already under way.

Acceptance criteria:

- Neither edge can reduce the window below a minimum length.
- The edge stops at that limit and stays under the pointer's control — it must
  not jump, snap back, or drop the gesture.
- The limit holds for both edges and for video and audio alike (one windowed
  branch serves both).
- Committing at the limit stores the clamped value; the previewed width and
  the committed data still agree exactly, which is what `quantize`-then-`clamp`
  is for.

**SCOPE IS WIDER THAN THE MODAL.** `trim-gesture.ts` is the shared reducer —
the same code backs the trim handles on the strip's CARDS. A floor added here
lands in both places, which is almost certainly right (a card edge can collapse
a clip today too) but is worth knowing before it is called a modal fix. The
package has `trim-gesture.test.ts` beside it; the floor belongs there as a unit
test, not only in a story.

**Which limit was meant needs settling.** Two readings of "constrained as far
as end points", and they are different products:

- **A minimum window** — an edge may travel until some floor of remaining clip
  and no further. This is the reading assumed above, and it is the one that
  matches the mechanism found. A floor needs a number: one frame is the honest
  minimum, the 0.1s quantize grid is the cheapest, and something like half a
  second is what actually keeps a clip usable.
- **A hard halfway stop** — neither edge may pass the midpoint, so no single
  edge can take more than half the clip. This is closer to the words "cannot be
  dragged to middle" but is a stronger rule, and it would forbid legitimate
  trims (keeping the last two seconds of a ten-second take is one edge doing
  80% of the work).

Recommend the minimum window. Say which before it is built — the two are the
same change to the same two lines and a completely different editing tool.

## PL15-016 — The strip stutters while it is panned

- Status: Complete — CONFIRMED BY THE OWNER in the app, and NEVER PROFILED.
  Both halves of that are the status.

  The drag offset is off the React render path: the transform reads
  `var(--drag-px, 0px)` and the move handler writes that property straight to
  the row, so a pan touches one style property on one node and React is not
  involved. The structural cause is gone and the owner reports the pan reads
  fine.

  What was NOT done is the before/after profile this item opens by demanding.
  So the evidence is a removed cause plus a person using it — which is the
  evidence PL14-006 says actually counts, and is still not a measurement. If
  the stutter ever returns, start by taking the profile that was skipped rather
  than assuming this change was wrong.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details, then drag the strip sideways)
- Area: `components/graph-view/graph-item-details-modal.tsx` (the `swipe`
  handlers, `dragPx`, `rowTransform`),
  `components/graph-view/graph-item-details-panel.tsx`
- Screenshot: Not captured

Grabbing the film strip in the details modal and panning it stutters. It does
not track the hand. Find out why, fix it, and sweep the rest of that surface's
performance while there.

**MEASURE BEFORE CHANGING ANYTHING.** This repo has already paid for the other
order: three playback optimizations were built and then REJECTED because the
measurement did not support them. A profile of an actual pan — frame timings,
what is re-rendering, what is decoding — comes first, and the same profile run
again is what says the fix worked. "It must be the re-renders" is not evidence.

**The leading hypothesis, and it is a specific one.** The gesture stores its
start coordinate in a ref, and the comment beside that ref says exactly why:

> Not state: this changes on nearly every pointer move and only the ROW's
> transform cares. A re-render per move to store a start coordinate would
> re-render three live panels — video elements included — sixty times a second
> for the duration of a swipe.

But the OFFSET is state. `onPointerMove` calls `setDragPx(swipeOffset(dx, …))`
on nearly every move, and `dragPx` is read by `rowTransform`, which is built in
the modal's own render. So the re-render-per-move the ref was written to avoid
happens anyway, one level up — and it re-renders the whole modal, which mounts
up to `MOUNTED_RADIUS` × 2 + 1 panels, each a video element, a trim strip and
a tag editor.

If the profile agrees, the shape of the fix is to move the drag offset off the
React render path entirely: write the transform to the row element directly
(a ref plus a style write, or a CSS variable set on the wrapper) and keep
`dragPx` in state only at the boundaries where a render genuinely has to
happen — the start of the gesture and its commit. The row already opts out of
its transition while `dragPx !== 0`, so nothing in the choreography depends on
the value passing through render.

**Do not stop at the first plausible cause.** Other candidates in the same
area, worth including in the same profile rather than a second pass:

- `rowTransform` is a `calc()` string built from `panelWidth`, itself a `min()`
  expression — re-parsed per frame.
- The panel under the playhead SEEKS itself while it is a neighbour, on
  purpose, so a pan can be moving several media elements that are also seeking.
- A pan that crosses a step boundary commits, which starts the 420ms
  choreography — a stutter at the moment of landing is a different bug from a
  stutter throughout, and the two must be told apart before either is fixed.
- Container queries on panel width re-evaluate as the row moves.

Acceptance criteria:

- A profile of a pan, before and after, with the numbers stated — frame times
  or dropped frames, not an impression.
- The strip tracks the pointer through a full pan on a project with enough
  clips to be worth panning.
- The landing step is still one motion on one clock (`DETAILS_STEP_MS`); a
  fix for the drag must not desynchronise the commit.
- Whatever is found is written down beside the code, including anything that
  turned out NOT to be the cause — the rejected candidates are the expensive
  half of this and should not have to be re-derived.

## PL15-017 — A caret under the minimap's active segment

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details — the minimap under the bar)
- Area: `components/graph-view/graph-seam-minimap.tsx`,
  `components/graph-view/graph-seam-lane.tsx` (`MARK_HALF_PX`,
  `MARK_HEIGHT_PX` — the existing mark to match)
- Screenshot: Not captured

The minimap marks the clip you are on by turning its segment white and
raising it a pixel. Add a small white triangle pointing UP, centred under that
segment — a second, plainer signal that this is the active one.

**It is the same idiom the bar already uses, which is the argument for it.**
The minimap's own comment says the white was chosen "because that is what the
bar above marks its active clip with — the triangle and its rule. The same
claim in the same ink, said twice at two scales." The bar's mark
(`data-seam-active-mark`) is a CSS-border triangle in `rgba(250,250,250,0.95)`
sitting ABOVE the film pointing down at it. This is its twin at the smaller
scale, below and pointing up. Build it from the same two constants rather than
new numbers.

Acceptance criteria:

- A white triangle, pointing up, centred horizontally on the highlighted
  segment.
- It moves with the highlight — stepping to another clip moves the caret.
- It does not overlap or obscure the segments themselves.
- It stays inside the rail at both ends: the first and last clips' segments
  are at the very edges, and the bar's mark already clamps for exactly this
  reason ("a mark drawn past the end of the bar is not reporting a position at
  all").
- The minimap is `aria-hidden` and the caret is decoration; it stays that way.

**Render it INSIDE the highlighted segment, not positioned over the rail.**
This is the one thing that will otherwise cost an afternoon. The segments are
flex children sized by `flexGrow: clip.showingSeconds` with per-seam
`marginLeft`, so a segment's centre is NOT computable from a percentage of the
rail the way the window and the playhead are (`asPercent(seconds)` works for
those because they are positioned against total duration, not against a flex
run). Reproducing the flex layout in arithmetic to place the caret would be a
second implementation of the layout that drifts the moment a seam gap changes.
A child of the centre segment at `left: 50%` with a half-width translate lets
flex do it, and is correct at every width.

**Check the vertical room first.** The rail is 14px (`h-3.5`), the segments
are 6px (`h-1.5`) at `top-1`, and the active one grows a pixel each way — so
the run occupies roughly y=3 to y=11 and there are about three pixels beneath
it before the rail ends. That may be enough for a caret this small or may not;
if it is not, the honest fixes are a taller rail or a caret that overlaps the
segment's lower edge, NOT one that spills outside the rail into the controls
below it.

## PL15-018 — Bring the MCP tools back up to the app

- Status: Partial — `set_disabled` (which existed on NEITHER surface) and
  `set_lane` are now in-page. `set_tags`, `set_start` and `set_layer_frame`
  remain server-only; the doc's stale tool count still needs correcting. The
  "generate both surfaces from one declaration" question in this item is
  untouched and is the thing that stops it recurring.
- Area: `lib/webmcp/tools.ts`, `lib/mcp/write-handlers.ts`,
  `components/graph-view/graph-mcp-tools.tsx`, `docs/webmcp-agent-tools.md`
- Screenshot: Not captured

The agent tool surface has fallen behind what the app can do. Bring it level.

**The drift, measured rather than asserted.** There are two surfaces: the
in-page WebMCP tools (which mutate the live store) and the server-side
handlers behind `/api/mcp`. Counted today:

- **WebMCP — 14 tools:** `read_timeline`, `move_clip`, `trim_clip`,
  `rename_item`, `remove_clip`, `get_view_state`, `select_items`,
  `clear_selection`, `focus`, `go_up`, `set_preview`, `play`, `pause`, `seek`.
- **Server handlers — 8:** `move_clip`, `trim_clip`, `rename_item`,
  `set_tags`, `remove_clip`, `set_lane`, `set_start`, `set_layer_frame`.

So four write verbs exist on the server and have NO in-page equivalent:
`set_tags`, `set_lane`, `set_start`, `set_layer_frame`. An agent working in
the browser — the whole point of the two-writer loop — cannot tag a clip, put
it on a lane, pin its start, or choose its layer frame, while the same agent
hitting the endpoint can.

**And things shipped since have no tool at all.** `set_disabled` is the clear
one: enabling and disabling an item is a first-class action with its own
command (`set-node-disabled`), its own undo clause and controls in two
dialogs, and there is no way to ask for it. `create_collection` exists in
`lib/mcp/` but is not registered on either surface.

**The doc is stale in a way that matters.** `docs/webmcp-agent-tools.md` opens
with "11 tools" against the 14 that are registered, and its own instruction is
"Keep it current as decisions land." A count that is wrong by three is the
cheapest possible signal that the decision log stopped being kept, so the doc
is part of this item and not a footnote to it.

Acceptance criteria:

- The in-page surface covers every write the server handlers do — no verb an
  agent can perform through the endpoint but not in the page.
- `set_disabled` exists, dispatching `set-node-disabled` through the same
  command path the dialogs use.
- Every new tool returns the repo's `Result`-shaped rejection rather than
  throwing, and refuses rather than guessing — the existing tools' contract.
- Nothing is left orphaned: a tool that can move or remove a node obeys the
  hard rule that nothing may be parentless (refuse, or route to trash).
- `docs/webmcp-agent-tools.md` names the real tools and the real count, and
  its decision log records what landed here.
- Tests beside each new tool, matching the existing per-tool `.test.ts`
  pattern in `lib/webmcp/` and `lib/mcp/`.

**The trap that will waste an afternoon otherwise: the connector CACHES its
tool list.** A newly added tool does not appear until the client refreshes it,
and the failure mode is a tool that is definitely registered and definitely
absent from the agent's view — which reads as a setting that does not exist
rather than as a cache. Refresh the connector before concluding anything is
wrong with a new tool.

**Worth deciding as part of this:** whether the two surfaces should stay
separately hand-maintained at all. They have already drifted by four verbs,
and drifting is what two hand-written lists of the same thing do. The write
handlers are shared logic; the registration is not. A single declaration both
surfaces are generated from would make this the last time this item is
written — which is a bigger change than "add four tools" and should be an
explicit choice rather than a discovery halfway through.

## PL15-019 — Dragging the Media tool opens two file pickers

- Status: IN PROGRESS — a guard is applied, the DIAGNOSIS IS UNPROVEN. The
  StrictMode theory below could not be reproduced: with the guard removed, a
  story that wraps the component in `StrictMode` still counts exactly one
  picker request, because React only double-invokes effects in a development
  build of React and the storybook build is not one. So the guard is correct
  defensive code — an effect that opens a picker should be idempotent — but it
  is NOT established that it fixes what was reported. The decisive check named
  below (watch the real dev app, and a production build) has not been run.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (drag the Media tool from the controls row onto the board)
- Area: `components/graph-view/graph-tool-buttons.tsx` (`MediaDropTarget`),
  `apps/timeline-gstudio001/next.config.ts` (`reactStrictMode`)
- Screenshot: Not captured

Using the Media tool to add a clip opens the OS file picker, and then opens a
second one immediately behind it. One drop, two prompts.

**The cause, and it is a specific line.** The drag path parks the drop
position and then asks for files through `MediaDropTarget`, which opens the
picker from a MOUNT EFFECT:

```
const open = useCallback(() => inputRef.current?.click(), []);

useEffect(() => {
  if (hadUserActivation) open();
  else promptRef.current?.focus();
}, [hadUserActivation, open]);
```

`open()` is a side effect with no guard, fired from an effect that runs on
mount. `reactStrictMode` is `true` in `next.config.ts`, and StrictMode
deliberately double-invokes mount effects — mount, unmount, remount — so the
input is clicked twice and the browser opens two pickers. `open` is a
`useCallback` with an empty dep array, so it is stable and the second run is
the remount rather than a changed dependency.

This is exactly the class of bug StrictMode's double-invoke exists to surface:
an effect that is not idempotent. The effect body is doing something that
happens TO THE USER rather than something that sets up and tears down.

**CONFIRM IT IS DEV-ONLY BEFORE FIXING ANYTHING.** StrictMode's double-invoke
does not happen in a production build, so if this is the cause the deployed
app opens one picker and only the dev server opens two. That changes the
severity completely and is one build to check. Do that first — and if
production ALSO doubles, the cause is something else (two `MediaDropTarget`s
mounted at once, from the grid and strip surfaces or from a sub-timeline row,
is the next place to look) and everything above is wrong.

Acceptance criteria:

- One drop of the Media tool opens exactly one picker, in dev and in
  production.
- Cancelling the picker still dismisses the pending drop as it does now.
- The keyboard path is unchanged: with no user activation the prompt is
  focused rather than a picker opened, which is the branch that makes this
  reachable without a mouse at all.
- The fix is a guard on the SIDE EFFECT — a ref that records the picker was
  already opened for this pending drop — not switching StrictMode off.
  StrictMode found a real defect here; turning it off would hide the next one.

**Worth a sweep while in there.** Any other effect in this area that opens a
picker, starts an upload, or dispatches a command on mount has the same shape
and the same bug, and would show the same way — twice in dev, once in
production, and nobody notices until someone watches carefully.

## PL15-020 — A preview-height invariant regressed somewhere in this list

- Status: OPEN — reproduced, NOT attributed, and INTERMITTENT. Raised by me,
  against my own work. Rate measured at the end of the list: 4 of 6 passing in
  isolation, and a full suite run that came back entirely green — so a green
  run is NOT evidence this is fixed. `origin/main` passed it 6 of 6.
- Area: `apps/timeline-gstudio001/tests/e2e/graph-view.spec.ts`
  (`preview height is the user's: tree growth never steals it, and a toggle
  restores it`)
- Screenshot: Not captured

One e2e test fails on `punch-list-15` and passes on `origin/main`. It asserts
that expanding a sub-graph must never shrink the preview pane — the preview
opens at 380 and is measured again after a sub-graph is expanded, where it
comes back 207.

**What is established:**

- `origin/main` passes it **6 times out of 6**.
- The branch fails it, in the full suite and in isolation.
- The whole suite is otherwise green: 176 passed, 4 skipped, this the only
  failure.

**What is NOT established, and the attempt is worth recording so it is not
repeated blind.** A per-commit bisect gave non-monotonic answers — `d7882f3`
(the minimap caret) failed 3/3 while `a669bf5`, which is LATER, passed 3/3,
and the branch tip has given both 1-of-2 and 3-of-3 failures on different
runs. So the per-commit results are measuring run-to-run variance, not the
change under them, and every conclusion drawn from them is void. That includes
two I drew and then disproved:

- "It is the empty-collection placeholder in the sub-timeline row." Removing it
  passed twice, then the same removal failed twice. Taking the placeholder out
  of the flex flow did not help either, and reverting
  `graph-sub-timelines.tsx` **entirely** to its pre-PL15-010 state still
  failed.
- "It is the preview's new audio island." It fails with
  `workbench-display-surface.tsx` stashed.

**Where to start, since the bisect cannot be trusted:** instrument rather than
sample. The height comes from `initialSurfaceHeight` / `clampToViewport` in
`workbench-display-surface.tsx`, and both derive from
`getViewportBoundaryBottom() - rootTop`. Log those two numbers on `origin/main`
and on the branch at the moment the sub-graph expands; the one that moved names
the cause. 207 against 380 is a large difference and should be obvious once the
inputs are printed rather than inferred from a pass/fail.

**THE MECHANISM, MEASURED — this is the useful part.** Instrumenting the clamp
inputs at the moment of the expand gives, at this test's 1280x480 viewport:

```
innerHeight 480   rootTop -119 (clamped to 0)   mainBottom 606   scrollY 132
```

and the ceiling is
`getViewportBoundaryBottom() - rootTop - MIN_TIMELINE_SPACE`, with
`MIN_TIMELINE_SPACE = 260`. `getViewportBoundaryBottom` is
`min(mainBottom, innerHeight)` = 480 here, so the ceiling is **at most
`480 - 260 = 220`** and less once the page has scrolled — 207 is exactly
`220 - 13` of `rootTop`.

So the preview OPENS at `DEFAULT_SURFACE_HEIGHT` = 380, which is far above a
ceiling that can never exceed 220 at this viewport. The invariant does not hold
because 380 is legal; it holds only for as long as `clampToViewport` DOES NOT
RUN AGAIN after the pane opens. Anything that causes one extra observer or
scroll to fire after the expand cuts 380 down to the ceiling that was always
there.

That reframes the bug. It is not "something shrank the preview" — it is "the
opened height was never within the clamp's own limit at this viewport, and the
test passes only while nothing re-checks". Which is also why a bisect thrashes:
the question is not WHICH change resized anything, it is which change added a
re-check, and that is timing-shaped rather than layout-shaped.

Two ways out, and they are a product decision rather than a test one:
`initialSurfaceHeight` should not open the pane above its own ceiling (it
clamps against `maxSurfaceHeight` but the restore path does not), or the test's
480px viewport is simply below the height this pane is designed for and should
say so.

**THE CEILINGS DID NOT MATCH, and fixing that did NOT fix this.** Both halves
matter.

`initialSurfaceHeight` passed its own `maxSurfaceHeight` of
`available - dividerHeight` (~44px), while `clampToViewport` calls
`clampSurfaceHeight(height)` with no max and falls through to
`getManualMaxSurfaceHeight()`, which subtracts `MIN_TIMELINE_SPACE` (260). Two
ceilings more than 200px apart, and the pane opened under the loose one — so it
could open at a height the very next clamp would cut. That is a real defect and
it is fixed: the open path omits the argument and uses the same ceiling as
everything else.

It did not move the failure rate. Measured across three runs after the change:
4 of 6, then 5 of 6, then 6 of 10 — all within noise of the rate before it.
Recorded so nobody re-derives this fix expecting it to close the item.

**The residual, and it is the thing to chase next:** the ceiling itself MOVES.
`getManualMaxSurfaceHeight` is `viewportBottom - rootTop - MIN_TIMELINE_SPACE`,
and `rootTop` is the pane's position in the viewport — which changes with
SCROLL. So the pane can open under a legal ceiling and be re-clamped later
under a different one, without anything about the layout having changed, purely
because the page scrolled between the two moments. The probe caught exactly
this: `rootTop -119, scrollY 132` at the assert.

That reframes it as a product question rather than a bug: should a pane the
user sized shrink because the page scrolled? If not, the ceiling has to come
from something stable rather than from the live `rootTop`.

**MEASURED PROPERLY AT LAST — N=10, WITH A CONTROL.** Every earlier reading in
this item came from 3-to-6 sample runs with nothing to compare against, and all
of them were noise. With ten repeats per point and a pre-branch control the
picture is finally stable:

| Point | Contents | Invariant | Reveal |
| --- | --- | --- | --- |
| `aba9145` — before #530 | — | **10 / 10** | 6 / 10 |
| `7618fce` | PL15-001, 002, 007 | 9 / 10 | — |
| **`d8b8250`** | **+ PL15-003, 004, 012** | **6 / 10** | — |
| `a669bf5` | + 017, 009, 019 | 6 / 10 | — |
| `62368e4` | + 010, 011, 014, 015, 005, 006 | 5 / 10 | — |
| `origin/main` | everything | 5 / 10 | 5 / 10 |

Two conclusions, and the second corrects something said earlier in this file:

- **The drop is at `d8b8250`, which carries PL15-003** — the strip opening in
  Collections instead of flat. That changes what the board draws on arrival,
  so it changes the board's content height, so it changes where the page sits
  when the clamp runs. PL15-003 did not break the preview; it moved the ground
  under a ceiling that was always scroll-dependent.
- **THE REVEAL TEST WAS ALREADY 6 / 10 BEFORE ANY OF THIS WORK.** Earlier notes
  here blamed a clamp change for breaking it. That was wrong — it is a
  pre-existing flake and it is not part of this regression.

**Both candidate fixes were then measured the same way, and NEITHER works:**

| Fix | Invariant |
| --- | --- |
| Clamp only when the viewport actually shrank | 6 / 10 |
| Drop the live `rootTop` from the ceiling | 5 / 10 |

So the model — "the ceiling moves with scroll, stop it moving" — is either
wrong or incomplete. Something else is carrying this.

**What the next person has that nobody had before:** a control that scores
10 / 10 (`aba9145`), a bisect that localises the change to `d8b8250`, a
measurement protocol that distinguishes signal from noise (N=10; anything
smaller has produced flatly contradictory answers in this item three times),
and two disproved hypotheses. Start by diffing `d8b8250` against `7618fce` for
what it does to the BOARD's height, not for what it does to the preview.

---

**THE EARLIER ATTEMPTS, kept because they were reported here as conclusions
and were not:** The owner's
answer to the product question is settled: *no, a pane you sized should not
shrink because the page scrolled.* Implementing that is what keeps failing.

| Attempt | The invariant | The reveal test | Full suite |
| --- | --- | --- | --- |
| Match the two ceilings (shipped, #531) | no change (4/6, 5/6, 6/10) | fine | fine |
| Clamp only when the viewport actually shrank | **8 of 8** | **1 of 5 — broken** | not run |
| Drop the live `rootTop` from the ceiling | 3 of 5 | 5 of 5 | **175/2 — worse than main** |

Only the first is on `main`. The other two were reverted.

**THE SECOND ONE IS THE LEAD.** `clampToViewport`'s own comment says the
question it answers is "has the VIEWPORT shrunk under us" — and it is wired to
a `ResizeObserver` on `<main>`, which fires whenever CONTENT changes. It is
asking the wrong question, and gating it on a real viewport shrink fixes the
invariant outright.

It also breaks `the preview is UNCOVERED, and its contents do not grow inside
the reveal`, which means THE REVEAL HAS A HIDDEN DEPENDENCY ON THAT CLAMP. That
dependency is the thing to find. Until it is understood, the gate cannot go in
— and finding it is a smaller, better-defined job than the one this item
started as.

**Do not "fix" the test.** It is guarding a real invariant — the preview's
height is the user's and content growth must not steal it — and it was written
because the preview used to be fitted to whatever the lower pane left over.

## PL15-021 — The clock moves to the far left of the transport row

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details — the controls row under the bar)
- Area: `components/graph-view/graph-seam-strip-bar.tsx`
- Screenshot: Supplied by the owner

`0:08.4 / 2:16.0` sat at the far right of the controls row, beside reach and
the settings gear. It moves to the far LEFT, on the same line as the transport.

It arrived on the right because it came down from the scrub bar with the
transport, and the settings groups happened to end up around it. PL15-006 then
emptied the row's left cell by folding those groups into the gear — so the row
was carrying a bare third on one side and three controls crowded on the other.

Acceptance criteria:

- The clock is the leftmost thing in the controls row.
- It stays on the transport's line: it says where playback IS, which is the
  question the play button answers, and reading the two together is why it came
  down out of the scrub bar at all.
- The transport is still centred — the row is a three-column grid and the
  middle track is what centres it, so the left cell has to keep existing
  whatever is in it.
- Clock notation and tenths are unchanged.

## PL15-022 — The film strip can be drawn taller

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details — the gear menu's `size` group)
- Area: `components/graph-view/graph-seam-lane-size.ts` (new),
  `graph-seam-lane.tsx`, `graph-seam-strip-bar.tsx`,
  `graph-item-details-modal.tsx`
- Screenshot: Not captured

The bar's film was one fixed height. It gets a `SM · MD · LG` picker, in the
gear with the other settings — a posture you set and then work, which is the
same test that put frames, card and fit there (PL15-006).

`sm` is the height the bar has always drawn (48px), so nothing changes until
the control is used. `md` is 64 and `lg` is 88.

Acceptance criteria:

- The picker sits in the gear menu, labelled `size`.
- The film redraws at the chosen height; the hover card still hangs below it
  rather than climbing into it.
- The choice is remembered for the session and not persisted, like the reach
  and the view count.

**A CELL IS SQUARE, so this is not only a size.** `FILMSTRIP_CELL_PX` was the
lane height, and the number of frames a clip's box is cut into is its width
divided by that — so a taller film is a COARSER filmstrip as well as a bigger
one. That is the actual trade, and it is why three sizes are offered rather
than a slider: the values in between buy nothing and cost a decision.

**Three sizes, not a range**, for the same reason `VIEW_COUNTS` is `[3, 5]`.

## PL15-023 — The playhead appears before the preview does

- Status: Complete — and it needed NO new plumbing. `usePreviewSettled()`
  already existed and was already published to the board by context; the board
  already imports it elsewhere. This was one condition looking at the wrong
  flag. See the note at the end about the version I built first and threw away.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (toggle the preview pane open and watch the board)
- Area: `components/graph-view/graph-sub-timelines.tsx` (`showPlayhead`),
  `components/graph-view/graph-timeline-view.tsx` (`previewOn`),
  `packages/ui/timeline/viewport/workbench-display-surface.tsx` (`chromeIn`)
- Screenshot: Not captured

Opening the preview draws the red playhead on the board immediately, while the
pane is still sliding open. It should not appear until the preview is actually
there.

**The cause, exactly.** The board gates the line on
`showPlayhead = previewOn && clockWindow !== undefined`, and `previewOn` flips
the instant the toggle is pressed. The pane, meanwhile, animates open over the
surface's reveal duration. So the gate is "has the preview been ASKED for",
and what it needs to be is "is the preview THERE".

**The same problem was already solved once, in the surface, for the same
reason.** `chromeIn` exists so the divider and the transport fade in only once
the pane has finished:

> The divider and the transport are controls for a thing that is not there yet
> while the pane is still opening — drawing them mid-slide puts a play button
> on a two-inch sliver of video — so they fade in once it has finished.

A playhead on the board is the same kind of thing: a readout of a preview that
is not yet on screen. It should ride the same signal.

Acceptance criteria:

- The playhead does not draw until the preview pane has finished opening.
- Closing is NOT symmetric: the chrome "ride[s] the close down still visible,
  which reads as the board covering them rather than as two separate
  departures", and the playhead should behave the same way.
- A pane that is already open at first paint shows the playhead immediately —
  there is nothing to wait for, and `chromeIn`'s `wasOpenRef` exists because
  hiding and re-showing in that case is a flash.
- The strip's line, the grid's line, and the sub-timeline rows' lines all
  follow the same rule; `showPlayhead` feeds several places.

**Two routes, and the cheap one is wrong.** The board could start its own timer
for the reveal duration — but the app does not know that duration (the surface
supplies its own default), so this would duplicate a constant across a package
boundary and drift silently the first time the reveal is retuned. The honest
route is for the surface to PUBLISH when it has settled: it already computes
exactly this as `chromeIn` and already stamps `data-preview-chrome` on its own
region, so what is missing is only a callback (or lifting that flag) so a
sibling can read it. Prefer that.

## PL15-024 — Sizing the film should scale it in both axes

- Status: Complete, built as the FIRST of the three options — `fit` re-fits at
  the current size, so both promises hold. `pxPerSecond` is now "the scale at
  `sm`": every writer divides by the size factor and the single reader
  multiplies by it, which is what keeps `fit` landing on the width it measured.
  See the end of this item for the assertion that nearly went in wrong.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details, then the gear's `size` group)
- Area: `components/graph-view/graph-seam-strip-bar.tsx` (`scale`, `fitTo`),
  `components/graph-view/graph-seam-lane-size.ts`
- Screenshot: Not captured

PL15-022 made the film taller. It did not make it wider, so `md` and `lg`
currently stretch each thumbnail vertically against an unchanged time scale.
The horizontal scale should move with the height, so a bigger film means
bigger thumbnails rather than taller ones.

**Where it goes.** The bar's effective scale is one expression:

```
const scale = pxPerSecond ?? fitPixelsPerSecond(subjectCollectionSeconds, trackWidth);
```

`pxPerSecond` is null until somebody zooms or presses `fit`. Multiplying that
result by `laneHeight / SEAM_LANE_HEIGHT_PX` scales both axes by the same
factor — which also keeps a filmstrip CELL square and keeps the same number of
frames per clip, so a bigger film is genuinely a bigger version of the same
picture rather than a coarser one. (PL15-022 changes the cell count precisely
because only one axis moved; this would undo that side effect, which is the
better outcome and worth saying out loud.)

**THE CONFLICT, which needs deciding before it is built: `fit` stops fitting.**
`fit` means "this collection spans the track" — it computes the scale FROM the
measured width. Multiply that result by a size factor and at `md` or `lg` the
collection no longer fits the track, so a control whose entire promise is in
its name stops keeping it. Three ways out:

- **`fit` re-fits at the current size** — divide by the same factor inside
  `fitTo`, so fit always fits and only the unzoomed default and manual zooms
  carry the size factor. Keeps both promises; costs one place where the factor
  must be applied in reverse, which is exactly the sort of thing that drifts.
- **Size scales only the DEFAULT scale**, not an explicit zoom or fit. A user
  who has set a scale keeps it; a user who has not gets a proportional film.
  Least surprising, and does nothing for the case where you zoom first and
  resize second.
- **Accept that `fit` is a starting point, not an invariant** — simplest, and
  the one that makes the control lie.

Recommend the first. Do not build it before choosing, because the three differ
only by a couple of lines and are very hard to tell apart from the diff after
the fact.

Acceptance criteria:

- At each size the film's boxes are proportionally wider as well as taller.
- A filmstrip cell stays square, and a clip is cut into the same number of
  frames at every size.
- Whatever is decided about `fit` is written next to the code, since the name
  is a promise.

## PL15-025 — The film holds the track's edges instead of centring past them

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open clip 2 of a long collection)
- Area: `components/graph-view/graph-seam-strip.ts` (`clampStripOffset`, new),
  `components/graph-view/graph-seam-strip-bar.tsx`
- Screenshot: Supplied by the owner — clip 2 of 13, the film pushed to the
  right-hand third and most of the track empty.

The bar centres the clip you are on. That is right in the middle of a sequence
and wrong at either end of it: centring clip 2 of 13 pushes the film most of
the way across the track and leaves a screen of empty space beside it. It
should travel until its own edge reaches the track's and then stop, the way any
scroller does.

**The cause is one unclamped line.** `stripCentreOffset` returns
`containerPx / 2 - centre` and nothing bounds it, so an early subject yields a
large positive offset and the film is simply pushed off to the right.

Acceptance criteria:

- At the start of a collection the film's first box sits at the left of the
  track, not in the middle of it.
- At the end, the last box sits at the right.
- In the middle of a long sequence the subject still centres, unchanged.
- A film SHORTER than the track still centres — there is no edge to hold it
  against and nothing is being pushed off.
- The clamp applies to a user PAN as well as the default, or a flick lands back
  in the same gap.

**The lead is not slop.** `SeamEndCap` draws the end stop and its label OUTSIDE
the first and last boxes, at negative coordinates before the film begins — so
holding the film flush to the track would push its own `Start` marker off
screen. The clamp reserves exactly the stop's own room
(`CAP_WIDTH_PX + CAP_GAP_PX`), which is why that constant had to be exported
rather than guessed at here.

## PL15-026 — The subject's blue runs past the film to the minimap

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a media item's details)
- Area: `components/graph-view/graph-seam-ruler.tsx`
  (`RULER_BLOCK_ACTIVE_COLOUR`),
  `components/graph-view/graph-seam-strip-bar.tsx`
- Screenshot: Supplied by the owner

The ruler tints the active clip's stretch of scale sky — "the one thing in
this band with a hue", and the only saturated thing up there, which is what
makes it findable on a bar of two dozen blocks. It stopped at the ruler's own
band, so the clip being worked on was marked ABOVE the film and nowhere else.

The block continues downward now: through the film and into the space before
the minimap, so the subject reads as a COLUMN rather than as a tab sitting over
it.

Acceptance criteria:

- The active clip's tint runs from the ruler to the minimap, at the clip's own
  width.
- It travels with the film — panning moves it with the boxes.
- It paints BEHIND the frames rather than washing them.
- It takes no pointer: the lane owns every gesture on this track.

**The same constant, not a matched value.** The column reads
`RULER_BLOCK_ACTIVE_COLOUR` from the ruler rather than restating
`rgba(56, 189, 248, 0.30)`. Two ends of one band that drifted apart would be
worse than no band at all, which is why the ruler's constant is exported.

**There was no space below the film to fill.** `bottom: 0` inside the track put
the column flush with the frames — measured, the lane ends exactly where the
track ends, so the gap this item is about belongs to the MINIMAP's top margin,
not to the track. The column overhangs by that margin.

**Two numbers that must agree, and only one can live here.** The overhang is a
number in the bar; the gap is `mt-1.5` on the minimap's own root. Nothing
connects them, so `MINIMAP_GAP_PX` is named and says so — the failure if they
drift is a column that stops short of the map or runs into it.

**A CALLBACK WAS BUILT FIRST AND THROWN AWAY, and the reason is worth keeping.**
The recommendation above was to have the surface publish `chromeIn` through a
new callback, because "the app does not know that duration". That was right
about the principle and wrong about the facts — the signal was already
published, as `usePreviewSettled()`, and graph-board already consumes it a few
hundred lines from where this change landed.

The callback version also BROKE the reveal before it was replaced.
`chromeIn` goes true, false, true around an opening pane, and pushing each edge
out re-rendered the consumer twice at the moment the slide was starting — the
region's own height transition then never ran at all, which
`the preview is UNCOVERED, and its contents do not grow inside the reveal`
caught as an empty list of transition runs. A context read costs no re-render
in the consumer and has none of that.

Two lessons, both cheap to have had earlier: look for the signal before
building one, and be suspicious of adding a state update inside a window that
something else is animating — which is the same family PL15-020 identifies as
the cause of its own intermittency.

**THE STORY'S FIRST ASSERTION WAS WRONG, and the right one is more useful.**
It checked that after `fit clip` the boxes span no wider than the track — which
failed at 3321px against 1153px and looked like the fix was broken. It was the
assertion: the bar draws the whole REACH window, which is more clips than the
collection `fit clip` fits, so the boxes legitimately span wider than the track.

What actually has to hold is INVARIANCE: fitting must land on the same scale
whatever size the film is drawn at. That is what the story asserts now, and it
is a direct test of the design — `fit` computes from the measured width, so the
size factor must not be applied on top of what it stores.

## PL15-020 — the pane opened at a height it had to be talked down from

**THE MECHANISM, FOUND.** Instrumenting the failing assertion across six runs
showed the geometry is IDENTICAL every time (`innerHeight` 480, `rootTop` -119,
`scrollY` 132) and the final height is ALWAYS 207. The only thing that varied
was `initial` — the height captured just after the pane opens:

```
fail   want=380   got=207
pass   want=207   got=207
```

So nothing was shrinking the pane. It sometimes OPENED at 380 and was
corrected, and the test caught it mid-correction. Every hypothesis in this item
until now — ceilings that disagree, a ceiling that moves with scroll, a clamp
firing on content change — was chasing a shrink that was not happening.

380 is `DEFAULT_SURFACE_HEIGHT`, the unclamped value `surfaceHeight`
initialises to. The mount layout effect replaces it, and it set
`didInitialSizeRef.current = true` BEFORE calling the sizing — which bails when
`dividerRef.current` is still null. On those passes the pane kept 380 and,
because the flag was already set, never tried again; it reached its real height
only when some later clamp happened to fire. Latched on SUCCESS now.

**It improves the rate without eliminating it.** Identical conditions, N=10,
`--workers=1`: main 7 of 10, with the fix 9 of 10 (an earlier run scored 10).
Default parallel workers: 5 of 10 against 6 of 10. A second contributor is
still unfound.

**A measurement warning that caught me twice while doing this:** `--workers=1`
and the default worker count give materially different rates on this test. A
comparison has to hold that constant as well as N.

## PL15-027 — what the measurement actually found

**THE PREMISE IS PROBABLY WRONG. There may be no regression at all.** Speed
Insights was installed on **22 August at 22:52** (#514) — the day the chart
begins. The line is a smooth decay from ~95 to 66, not a step. A deploy
regression is a cliff on one date; an average converging as samples accumulate
is a curve. The score did not fall so much as it was never really 90.

That does not make the numbers acceptable — FCP 3.3s and LCP 5.43s are poor by
any reading — but it moves the question from "what did we break on the 23rd" to
"why has first paint always been slow", which is a different search.

**Sizes, gzipped, from a production build:**

```
all chunks   1771 kB raw   544 kB gzip
  router       234 kB       63 kB
  React        196 kB       61 kB
  framework    185 kB       58 kB
  main         130 kB       37 kB
  polyfills    109 kB       38 kB
```

544 kB gzipped across EVERY chunk on disk — not the first-load figure, so a
visitor fetches less than that. Heavy, but not obviously 3.2 seconds of
pre-paint work on a desktop connection. **Which points at execution rather than
bytes**, and makes the next instrument a profile of the first load rather than
more trimming.

**One real finding, and it is UNPROVEN.** `zod` reaches the client through a
STATIC chain: `graph-timeline-view` → `McpToolsBridge` → `lib/webmcp/tools.ts`
(653 lines of agent tool definitions) → `zod`. Everyone who opens a board
carries the agent tooling, and PL15-018 made it bigger this week. The bridge is
`dynamic(..., { ssr: false })` now.

**THE BEFORE/AFTER SHOWED NOTHING, AND THE INSTRUMENT IS WHY.** 544 kB baseline
against 545 kB with the change. Summing the chunks ON DISK cannot detect a
lazy-loading win — the chunk still exists, it simply is not fetched. The
manifests do not answer it either: the route's client-reference manifest lists
6 chunks totalling 98 kB, which is the server-boundary set rather than the
eager graph.

So the change is kept on its MECHANISM and explicitly not on evidence. The
measurement that would settle it is transferred JS before FCP in a real browser
load, and it has not been taken.

## PL15-027 — the server-rendered list, measured

Same conditions throughout: production build, 4x CPU, Slow 4G, `/`.

| | client-fetched | server-rendered |
| --- | ---: | ---: |
| LCP | 1,671 ms | **768 / 909 ms** |
| Load delay | 1,405 ms | **402 / 275 ms** |
| TTFB | 152 ms | 312 / 481 ms |
| CLS | 0.00 | **0.18** |

**LCP roughly halves and load delay drops by about a second**, which is exactly
the mechanism the insight named: the poster is in the initial HTML now, so the
preload scanner starts it instead of waiting for React to download, parse,
execute, fetch the list and render a card.

**TTFB rises ~160-330ms** because the server now does the Firestore read. That
is a real trade and a good one — a few hundred milliseconds on the server
bought about a second on the client.

**`fetchPriority` ALONE DID NOTHING, and that is the honest result rather than
a surprising one.** Applied without the server render it measured 2,095 ms
against a 1,671 ms baseline — noise, not harm. A browser cannot prioritise a
request it does not know exists. The two checks Chrome makes are not
independent: the hint only means something once the resource is discoverable.

**THE CLS IS RESOLVED — see PL15-027, the CLS, found and fixed, below.** It
was the root layout's `null` Suspense fallback, which predates this branch; the
notes here are kept as the state of the search at the time.

**(AS IT STOOD) THE CLS IS UNRESOLVED AND THE BRANCH SHOULD NOT SHIP UNTIL IT IS.** CLS went
0.00 to 0.18, above the 0.1 "good" threshold, and CLS is one of the four inputs
to the Real Experience Score — so this currently trades one Core Web Vital for
another.

What is known about it:

- It reproduces in TRACED loads, 2 of 2, as a single shift of 0.1837 about a
  second in. DevTools reports "no potential root causes identified".
- A `layout-shift` PerformanceObserver installed before navigation sees **zero
  shifts** — on a normal navigation and on a hard reload with the cache
  ignored.
- The before/after comparison is like-for-like (both traced), which argues the
  regression is real rather than an artifact.

Those two facts do not sit together yet, and until they do the cause is not
known. The next step is to reconcile them — an observer that survives the
trace's own reload — rather than to guess at a culprit. `AuthGate` wrapping the
page in `RootLayout` is the obvious suspect and is only a suspect.

## PL15-027 — the CLS, found and fixed

**THE TWO INSTRUMENTS NEVER DISAGREED. ONE OF THEM WAS NEVER RUNNING.** The
contradiction that blocked this item — a trace reporting 0.1837 and a
`layout-shift` observer reporting zero — was an artifact of how the observer was
installed. CDP's `initScript` is consumed by the navigation that installs it, so
it does not re-run on a reload; every traced measurement reloads the page, and
the observer was therefore absent from precisely the load being measured. Proved
directly: a trace started with `reload: false` plus a navigation that carries the
observer put both instruments on ONE load, and they agreed exactly — 0.00 and
0.00.

The instrument that does survive a reload is one injected SERVER-SIDE. A thin
proxy in front of `next start` that inlines the observer into every HTML response
measures every load, traced or not — that is what turned this from intermittent
to 13 of 13.

**THE SHIFT, MEASURED.** `main` moves `x:0 w:1385` to `x:260 w:1125`. One shift,
0.1837, the whole CLS of the page. 260px is `RAIL_OPEN_WIDTH_PX` exactly.

**THE CAUSE IS THE SUSPENSE FALLBACK IN THE ROOT LAYOUT, AND IT PREDATES THIS
BRANCH.** The rail is server-rendered, but inside `Suspense` with a `null`
fallback. The shell flushes with the boundary still pending — the initial HTML
literally reads `<!--$?--><template id="B:0"></template>` followed by `<main>` —
and the rail's markup arrives at 46% of the same response, inside
`<div hidden id="S:0">`, to be swapped in by script. While pending, a `null`
fallback reserves NO width, so `main` — its `flex-1` sibling — lays out across the
whole row and is shoved when the boundary resolves.

`origin/main` carries that same `null` fallback verbatim, and `app/layout.tsx`
was last touched before this branch. **So PL15-027 did not introduce this shift.
It made the page paint early enough to SHOW it** — the shift only scores when a
paint lands between the shell and the boundary resolving, and a 1,671ms LCP left
no such window. Speeding up first paint is what turned a latent bug into a
measured one, which is the honest version of "CLS regressed".

**THE FIX** reserves the rail's width in the fallback, from the variable the
server already publishes on the `html` element from the cookie — the same
variable, and the same reasoning, as #471. It is correct for both rail states
before anything paints, which no hardcoded number would be.

**MEASURED, before and after, same build pipeline, 4x CPU / Slow 4G, signed in:**

| | before | after |
| --- | ---: | ---: |
| loads shifting (injected observer) | 13 of 13 | 0 of 12 |
| worst CLS | 0.1837 | **0.0002** |
| `main` shoves | 13 | **0** |
| CLS (DevTools trace, raw server) | 0.18 | **0.00, 2 of 2** |
| LCP (raw server, warm) | 710 / 756 / 761 / 789 ms | 664 / 672 / 676 ms |

The only residual shift is a `span` whose truncated label fills in — 0.0002,
three orders of magnitude under the 0.1 threshold.

**LCP IS NOT PAID FOR IT, AND THE FIRST READING SAID IT WAS.** The first two
post-fix traces came back 1,159 and 1,085ms and looked like a regression. They
were a cold `next start`: render delay 546ms against about 100ms warm. Three warm
samples land at 664-676ms. Reporting the cold pair would have been wrong in the
same way that dropping `fetchPriority` on its null result would have been.

**A GUARD SHIPS WITH IT.** `app/root-layout-rail-reservation.test.ts` reads the
layout as source and fails if the fallback is `null`, does not reserve
`RAIL_WIDTH_VAR`, or is not `shrink-0`. Checked against `origin/main`: all three
assertions fail there and pass here, so it catches the real defect rather than
restating the fix. It needs to exist precisely because a future `null` fallback
reads as tidier rather than as a regression, and because nothing about the defect
is visible until the page is fast.

## PL15-028 — Cloudinary usage jumped; find out what changed

- Status: OPEN — first pass done from the five exported CSVs below. The
  mechanism is NARROWED but the attribution is CORRELATION, not proof: nothing
  here separates localhost and e2e traffic from real visitors, and that is the
  one split that decides whether this matters at all.
- Area: Cloudinary account usage (delivery, not storage); `app/page.tsx`,
  `app/projects-client.tsx` (poster delivery), `tests/e2e/`
- Screenshot: Not captured

Usage rose sharply over 21-23 August. The question is what changed.

**IT IS NOT UPLOADS.** Storage moved 795.5 to 903.1 MB across the week, +13.5%,
and +104 MB of that is video. A steady climb, no step. Whatever happened is on
the DELIVERY side.

**THE NUMBERS** (assumed MB — the export carries no unit header, and the totals
are the right order of magnitude for this account; worth confirming before
quoting them anywhere). 24 August is a partial day.

| date | image impressions | image MB | video MB | total MB | delivered video s | transformed video s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 18 Aug | 66 | 6.7 | 0.6 | 7.3 | 0 | — |
| 19 Aug | 133 | 3.2 | 1.5 | 4.6 | 0 | — |
| 20 Aug | 1,427 | 14.9 | 192.1 | 206.9 | 0 | — |
| 21 Aug | 967 | 36.6 | 113.5 | 150.0 | 864 | 260 |
| 22 Aug | 11,202 | 18.9 | 562.4 | 581.3 | 1,150 | 388 |
| 23 Aug | 13,907 | 161.2 | 236.6 | 397.8 | 616 | 20 |
| 24 Aug | 777 | 1.4 | 18.2 | 19.6 | 10 | 0 |

**THERE ARE TWO SPIKES, NOT ONE, AND THEY HAVE DIFFERENT SHAPES.**

- **Video bandwidth, 20-23 Aug** — 192, 113, 562, 237 MB against under 1.5 MB on
  the 18th and 19th. **20 August is the anomaly that matters:** 192 MB of video
  bandwidth with ZERO delivered video seconds. Delivered-seconds counts
  streamed or derived delivery, so bandwidth without it is originals being
  fetched whole. The transformed-seconds column says the same thing from the
  other side — 260, 388, 20, 0, which is almost nothing served through a derived
  rendition. Per-second rates agree: 22 August is 562 MB over 1,150s, about
  3.9 Mbps for something labelled 480p, which is not a 480p rendition.
- **Image impressions, 22-23 Aug** — 11,202 and 13,907, against 66-133/day on the
  18th and 19th. A hundredfold. At about 11.9 KB per impression on the 23rd these
  are thumbnails, so the cost is in the COUNT, not the size.

**WHAT CHANGED IN THAT WINDOW, and this is the correlation to test rather than
believe.** 22-24 August is this punch list's heaviest run of work, and two things
in it move image impressions specifically:

- **The e2e suite and the PL15-020 investigation.** PL15-020 alone ran the full
  176-test suite repeatedly, plus N=10 comparisons twice over, on the 23rd and
  24th. Every app load renders project cards with real posters. 13,907
  impressions is not a human browsing a three-project account.
- **PL15-027 made the projects list server-rendered.** Posters are in the initial
  HTML now, so the preload scanner fetches them on EVERY load — before it, a load
  that never executed React never fetched them at all. That structurally raises
  impressions per page view. It landed on the 24th-25th, so it does NOT explain
  the 22-23 spike; it is what to watch in the NEXT export.

Acceptance criteria:

- The spike is attributed to a NAMED source, with the report that proves it —
  Cloudinary's breakdown by referrer or user-agent, or by `public_id`. "Probably
  the e2e suite" is where this analysis stops, not where it should end.
- Localhost and CI traffic are separated from real visitors. If it is our own
  test runs, the finding is about test hygiene; if it is not, it is about
  delivery.
- The video question is answered separately from the image one: whether
  originals are being delivered where a derived rendition should be. 20 August —
  192 MB with zero delivered seconds — is the case to explain first.
- Whether anything should CHANGE is decided last and explicitly. Cloudinary
  public delivery was a deliberate call and is not a finding; a fetch or
  transform default is a different question from access.

**Worth settling while in there:** whether e2e runs should point at fixture
posters rather than at Cloudinary at all. Test runs that bill a delivery account
scale with how often the suite runs, which is exactly the thing this list has
been doing more of.

## PL15-029 — The details modal stops being a modal and becomes the content area

- Status: COMPLETE. Built and verified in the app: the view is a `<section>` in
  the content area, the board is hidden but mounted, `?details=<nodeId>` deep
  links from a cold load, and Back closes it. Two decisions were the owner’s:
  routed and deep-linkable, and the board hidden rather than unmounted. See
  "PL15-029 — what the container change actually cost" at the end of this list.
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
  (open a clip's details from the board)
- Area: `components/graph-view/graph-item-details-modal.tsx`,
  `components/graph-view/graph-board.tsx` (mount point),
  `components/graph-view/graph-view-config.ts` (panel geometry),
  `hooks/use-dialog-focus.ts`
- Screenshot: Not captured

Opening an item's details should not throw a modal over the board. It should
REPLACE what is in the content area, the way a view does — the board goes away,
the details come in, and you come back to the board when you leave.

**What it is today.** `GraphItemDetailsModal` is mounted once from
`graph-board.tsx` and `createPortal`s itself onto `document.body` as
`role="dialog" aria-modal="true"`, over a scrim
(`fixed inset-0 z-[80] ... bg-black/80 backdrop-blur-sm`). It is 1,555 lines and
it is not only a clip panel: for a collection node it renders
`CollectionDetails` instead, so it is already the router between two bodies
rather than one screen.

**This is a container change, not a restyle, and four things are wired to the
container.**

- **`aria-modal` stops being true, and it currently IS true.** `useDialogFocus`
  exists precisely because the attribute was once a lie: it moves focus in,
  cycles Tab inside, and restores focus on close to the card the modal was
  opened from. A content view must NOT trap Tab — trapping focus in something
  that is not modal is the same defect in the other direction. But the RESTORE
  is still wanted, because it is what keeps the board's roving focus from
  resetting. So the hook is split, not deleted.
- **Escape needs an explicit owner.** Today "Escape, the close button and the
  scrim all go through one path", and the scrim is about to stop existing. A
  view that fills the content area and closes on Escape is competing with every
  other Escape handler on the page, and that competition is already a known
  sore spot in the selection work.
- **The geometry is viewport-relative and will be wrong in flow.**
  `DETAILS_PANEL_HEIGHT_CLASS` is `h-[68vh] max-h-full` and
  `DETAILS_ROW_FLOOR_CLASS` is `min-h-[min(68vh,calc(100vh-26.625rem))]`. Those
  are correct for a panel centred in the viewport under a fixed scrim with
  `pt-[14.75rem]`; inside `main` they size to the window rather than to the
  region, so the panel will overflow or float depending on what else is on
  screen. They have to be derived from the CONTAINER.
- **The board underneath has to go somewhere.** Unmounting it loses scroll
  position, selection and any in-flight dnd state; hiding it keeps the whole
  board mounted behind a view that covers it, which is the cost the grid
  virtualization item is already about. Neither is obviously right and the
  choice should be made deliberately.

Acceptance criteria:

- Opening details replaces the board in the content area. No scrim, no portal
  to `document.body`, no `aria-modal`.
- Tab is not trapped. Focus still moves into the view on open and still returns
  to the originating card on leave.
- Escape has ONE named owner and the item says who it is.
- The panel sizes to the content area, not to the viewport, at both rail widths
  and with the preview pane open and closed. PL15-020's invariant still holds:
  nothing here may steal the preview's height.
- Prev/next between items — `detailsWindow`, and the swipe path — still works.
- Storybook covers the new container, per the repo rule that timeline/media
  changes bring stories: selected state, a missing poster, a short clip and a
  long one.

**Three things to settle when this is worked:**

- **WHICH modals.** Read here as the ITEM DETAILS modal. The shortcuts sheet is
  the other portalled dialog and should stay a modal — it is help ABOUT the
  screen, not a screen. Collection details is reached through this same
  component, so on the face of it it moves too; if it should stay a dialog, that
  splits the component and is worth knowing before starting.
- **Does it get a URL?** A modal is a state; a content view is a place. If
  details now replace the content area, back/forward and a shareable link are
  the natural expectation — and that is a router change well beyond "stop
  portalling", so it should be an explicit yes or no rather than discovered
  halfway.
- **Does it animate in, and how.** `withViewTransition` is already used here.
  Beware the known trap: a view transition does not paint the page, so a moved
  named element leaves a black cut-out, and a snapshot cannot deform. Card to
  full-width view is exactly the shape that bites.

## PL15-030 — The reference design for the details view

- Status: MOSTLY COMPLETE. Built and verified in the app: the five-control
  transport reaching both ends, skimming feeding the one shared preview with
  the playhead untouched, and the visual pass (the bar’s lit panel, the
  quiet-label treatment). ONE PIECE DELIBERATELY NOT BUILT — the preview’s
  340ms dismiss animation, which collides with PL15-020 and should wait for
  it. See "PL15-030 — what the reference actually asked for" at the end.
- Reference: `punch-list/reference/storyboard-playbar.html`, vendored into the
  repo because that is the readable one and a Downloads folder is not a spec.
  Also supplied: `storyboard-react-demo.html`, the same design as a Tailwind v4
  build — it carries the identical tokens (`--color-ink: #08090d`,
  `--color-signal: #3cdbc0`, …) but ships as a MINIFIED BUNDLE whose source
  cannot be recovered, so it is a picture, not a spec. Rendered at
  https://claude.ai/public/artifacts/d7b2d207-7326-4ad9-9022-152adb1250c8
- Area: pairs with PL15-029 — that item is the CONTAINER change, this one is
  what goes in it.
- Screenshot: Not captured

**THE ONE IDEA WORTH TAKING, and the reference names it in a comment:
`the one shared preview`, with `the content area lives below it`.** One preview
at the top, whatever you are looking at feeds it, and everything else is
underneath. That is our existing preview display — the reference does not ask
for a second player, it says what the one we have should MIRROR.

**IT AGREES WITH PL15-029 FROM THE OTHER DIRECTION.** No scrim, nothing dimmed,
no overlay: a ground, a preview, and a content area below. Two independent routes
to the same answer.

**What the preview mirrors, with the precedence spelled out** (`playerRender()`).
The reference orders it take > skim > sequence; takes are out (below), so:

- **Skimming** — hovering or scrubbing the ruler skims frames straight into the
  player. Label is `SH nn · <section>`, time is `tc(skim) / tc(DUR)`.
- **Otherwise** — the sequence playhead. Label `SEQ 04 · <section>`, time
  `tc(t) / tc(DUR)`.
- **The scrub fill tracks `t`, never the skim.** Skimming changes the FRAME and
  the LABEL and leaves the fill where playback is. That is the detail that makes
  skimming feel like looking rather than like seeking, and it is easy to lose.

**The preview is dismissible, and that is a real behaviour, not a nicety.**
`setPlayerOpen()` animates height 0 <-> `scrollHeight` with opacity over **340ms**
and `prefers-reduced-motion` short-circuits to `display:none` with no animation
at all. Two controls: a toggle in the content area's header and a close on the
player itself. Two details worth copying exactly:

- It calls `playerRender()` BEFORE animating open, so the frame is current the
  moment it reappears rather than one frame stale.
- It scrolls the window to top on open, because the preview and the playbar
  share the viewport — reopening the preview otherwise pushes the playbar out of
  view.

**The transport is start / prev / play / next / end**, and it is bounded rather
than wrapping: prev and next go `disabled` at the ends. `start` sets the time to
0 AND scrolls the viewport to 0; `end` sets it to `DUR` and scrolls to the end —
time and scroll move together, which is what stops the playhead ending up
somewhere you cannot see.

**The playbar is the larger half, and most of it maps onto things we already
have** — so the value here is the geometry and the gestures, not new concepts:

- `--pxs: 44px` per second, deliberately mirrored in CSS and JS.
- A 40px ruler with ticks and labels; 26px labelled section lanes, where clicking
  a section smooth-scrolls the viewport to it.
- A 150px filmstrip of shots built from per-frame cells, `cursor: grab`, with
  real INERTIA — a fling with momentum and an explicit `cancelMomentum` on every
  competing interaction.
- A playhead in three parts: a line, a **timecode chip** (`--chip #f3f6f9`), and
  a triangle; it gains a glow while playing.
- A hover ghost that previews where a click would land.
- A 28px minimap: drag the window to pan, click to jump, with its own playhead in
  `--alarm #ff5c5c` — a different colour from the selection accent on purpose.
- Timecode is `mm:ss:ff`, frames included.
- A first-run coach mark, dismissed by the first skim — "the lesson is learned by
  doing". The file explicitly notes the "seen" flag must be persisted by the app,
  which is the part a copy would drop.

**The three calls, made by the owner:**

- **TAKES ARE OUT.** The deck of swipeable takes with the centre card active, the
  `17 takes · 02:00` header, the `TAKE · SH nn` player source, and the
  "auditioning: keep rolling on the next take" autoplay all drop. This is the
  simplification that collapses the player's three-way precedence to two, and it
  removes the only concept in the reference that our model does not have.
- **PREV/NEXT MEAN THE NEXT CLIP.** Unambiguous now, and it settles the collision
  the first draft flagged: PL15-029's item-level prev/next and this transport are
  the same verb on the same thing, so there is one behaviour to build, not two
  that have to be told apart.
- **THE ACCENT STAYS SKY BLUE.** The reference's `--signal: #3cdbc0` teal is NOT
  adopted. PL15-026 already runs the subject's blue from the film through to the
  minimap off one exported constant, and that constant remains the single source
  — the reference's teal is read as "there is one accent and it is used
  consistently", which we already do, in our colour.

Acceptance criteria:

- One preview, at the top, and it is the EXISTING preview display. No second
  player anywhere in the tree.
- The preview mirrors skim over sequence, with the labels and timecodes above,
  and the scrub fill follows playback rather than the skim.
- The preview can be dismissed and restored, from both controls, with the
  reduced-motion path taking no animation; the frame is current on reopen and
  the playbar stays in view.
- Transport is start / prev / play / next / end, prev/next step CLIPS and
  disable at the ends, and start/end move time and scroll together.
- The accent comes from the existing exported constant. No teal is introduced.
- Stories cover it per the repo rule: selected state, missing poster, short and
  long clips, a many-clip timeline — plus the reduced-motion dismiss path, which
  is the branch a story is the only cheap way to see.

**One thing still to settle:** the reference loads **Martian Mono** and **Spline
Sans Mono** from Google Fonts and uses them for every label. Our root layout says
Grandstander is the only custom font and everything else rides `font-sans` — on
purpose. Two new families for metadata is a typographic decision and a
first-paint cost (the rail's own CLS fix in PL15-027 is what a late font does to
a layout), so it should be an explicit yes or no rather than arriving with the
component.

## PL15-029 — what the container change actually cost

**THE ARITHMETIC WAS THE FEATURE, AND DELETING IT WAS THE WORK.** The scrim
reserved its own edges with `pt-[14.75rem]` and `pb-[4.875rem]`, because the
header and the bar were absolutely positioned so the row could centre without
them affecting its width — which meant they took no space, and every change to
the bar had to be measured and then paid for TWICE (`items-center` shares
padding added at the top with the bottom). In flow they occupy the space they
occupy. There is no number left to keep in step.

**THE ROW STILL NEEDS WHAT THE SCRIM GAVE IT.** `justify-center` and
`items-center` came free from the scrim; in a column they are `self-center` — a
flex item wider than its container centres by overflowing equally both sides,
which is what puts the subject mid-screen — and `my-auto`. `my-auto` alone was
not enough: it only separates anything when there IS free space, and
`TheTwoBarsAreAdjacent` caught the row butting against the bar at 0 against its
floor of 16. `gap-6` is the minimum; `my-auto` spends whatever is left over.

**THE WIDTH BASIS TOOK THREE GOES, AND THE SECOND ONE LOOKED RIGHT.**
`panelWidthsFor` was `100vw`, correct while the scrim WAS the viewport.

- `100%` cannot work: the row must stay content-width to centre by
  overflowing, and a percentage inside an auto-width box has no definite basis.
- `100cqw` measures correctly for the PANELS and is still wrong. Container
  units resolve against the nearest ancestor container, names ignored, and
  every panel declares `@container` for its own internals — so the same
  expression means "the view" on a panel and "the panel" inside one. The
  heading deliberately reuses this width so it is sized by its ROLE rather than
  by the box it sits in, which is what keeps it still while the box animates.
  `vw` was global and immune; `cqw` made it follow the box, and
  `TheNameDoesNotReTruncateWhileTheCardResizes` caught it — 173px becoming 68
  the moment the story shoved the two boxes onto each other's widths.
- A pixel length published by the view (`--details-basis`, from a
  ResizeObserver) means the same thing at every depth. Measured in the app with
  the rail open: viewport 1485, basis 1146, neighbours 284, centre 497 —
  (1146 - 48 - 32) / 3.75 and then x 1.75 exactly, tracking the rail with
  nothing to keep in sync.

**A `useState` SETTER IS A CONTRACT, AND ROUTING BROKE IT.** `setOpenId` had
been a state setter for its whole life, so consumers treat it as stable — one
does literally: `useEffect(() => setOpenId(id), [id, setOpenId])`. Deriving it
from `openId`/`pathname`/`searchParams` gave it a new identity whenever the open
item changed, turning that effect into a loop that reopened the clip you had
just left. It surfaced as four stories reporting "clicking a neighbour does not
advance", which is exactly what it looked like from outside. The live values
come from an effect-synced ref now, and the callback depends only on `router`.

**THE BOARD KEEPS ITS PLACE, AND `display: none` DOES NOT KEEP IT.** Hidden
rather than unmounted was chosen to preserve scroll, selection and any
in-flight drag — but the board scrolls the DOCUMENT, so hiding it collapses the
page from 1087px to 910 and the browser clamps the window scroll to 0. Measured:
scrolled to 177, came back at 0. The position is recorded on scroll (an effect
reading it after the fact sees 0, the hide having already happened) and restored
twice on close — immediately for the close button, and again a frame later,
because closing by Back is a popstate and the browser restores that entry's own
offset, recorded while the page was still short, AFTER the effect runs.

**TWO THINGS FOUND ALONG THE WAY THAT WERE NOT THIS ITEM.**
`withViewTransition` caught `finished` but never `ready`, which rejects with an
AbortError whenever a transition is SKIPPED — normal here, since opening a
second clip skips the first's animation. Unhandled, a test runner counts it
against whatever test happens to be in flight. And `apps/storybook` never
declared `nextjs.appDirectory`, which the gstudio workspace has always set: the
first component to read the router took all 53 of this view's stories down at
once, with nothing about routing in the message.

**Verified in the app, not inferred:** the deep link opens from a cold load, one
history entry per open, Back closes it and restores the scroll, and the view is
a `<section>` with the board hidden beside it. 1457 app tests, 807 unit, 334
story interactions, lint 0 errors.

## PL15-030 — what the reference actually asked for

**THE TWO DESIGN SYSTEMS WERE ALREADY THE SAME SYSTEM.** The view has its own
token file (`graph-details-design.ts`), and set beside the reference's `:root`
block most of it matches outright:

| reference | ours | |
| --- | --- | --- |
| `--stroke: rgba(255,255,255,.07)` | `HAIRLINE border-white/[0.07]` | identical |
| `--r-card: 12px` | `RADIUS_CARD rounded-xl` | identical |
| `--alarm` = the playhead, and only that | "RED — the playhead. Never anything else" | identical rule |
| `--panel-lo: #0b0d12` | `SURFACE_CARD #0d0d10` | within a shade |
| `--signal: #3cdbc0` | BLUE = a value you can edit | ours, by decision |

So the visual pass was never a restyle. Two things were genuinely missing, and
both are small:

- **The bar had no surface at all.** `data-seam-bar` was
  `flex w-full flex-col gap-2` — ruler, film and minimap sitting straight on the
  page, so the one instrument the view is arranged around was the only thing in
  it without edges. It gets the reference's lit panel: a `180deg` gradient
  through `#14181f → #0e1117 55% → #0b0d12`, an inset ring, and the lift.
  `inset 0 1px 0 rgba(255,255,255,.05)` is the half that does the work —
  without that single lit pixel along the top the gradient reads as a slightly
  different grey rather than as a surface catching light.
- **The quiet labels were too dark and untracked.** `zinc-600` (`#52525b`)
  against the reference's `#79828f`, with no tracking and no case change — dark
  enough that a label beside a value read as disabled rather than as quiet.

**THE TREATMENT IS WHAT CARRIES THE LOOK, WHICH IS EXACTLY WHY NO FONTS WERE
NEEDED.** With Martian Mono and Spline Sans Mono ruled out, tracking does the
work a display face would have done: at 10px, letters set close read as a word
and letters set apart read as a LABEL, whatever family draws them. `0.14em`
rather than the reference's `0.22em`, because tracking adds width per character
and ours sit in control rows that are already full — the reference can afford
more of it because its labels live in a strip with nothing beside them.

**THE EDGE IS A RING, NOT A BORDER, AND A STORY IS WHY.** The first version
used `border` + `HAIRLINE`, which is what every other surface here does. On a
panel this wide it moves everything inside in by a pixel:
`TheBarSpansTheFullWidth` caught the ruler starting at 25 where it must start
at 24, and its rule — "nothing else may narrow them" — is exactly right,
because the bar's rows and the cards below are read against each other. An
inset ring is drawn rather than laid out, so the alignment survives.

**THE TRANSPORT WAS HALF THERE.** Previous and next already stepped one CLIP
and already went dim at the ends, which is the reference's behaviour; only the
outer pair was missing. `jumpToEdge` is shared with `Home`/`End` so the key and
the button cannot drift, and it clears `followSuspended` — time and scroll move
together, which is the reference's own reason for setting both in one go.

The two pairs move DIFFERENT things, and the story says so because the
reference does not distinguish them: there, stepping the deck and moving the
player are one act. Here the jumps move time along the whole sequence and the
steps move which clip is the subject, so arriving at the last second says
nothing about whether there is a next clip. The first version of that story
asserted otherwise and failed.

**SKIMMING REUSED A SEAM RATHER THAN INVENTING ONE.** `frameOverride` already
hands the pane a frame to draw while `currentTime` is untouched — which IS the
reference's rule that the fill tracks playback and never the skim. And
`usePublishTrimPreview` already returns whether the pane took it, so the hover
card is not replaced: it becomes the pane-closed fallback, which is that seam's
own existing rule rather than a new one.

**TWO INSTRUMENTS WERE WRONG BEFORE ONE WAS RIGHT.** The pane draws
`frameOverride` to its own CANVAS from a cached element, so the visible
`<video>.currentTime` never moves and measuring it proves nothing — it read as
"the skim does not work" twice. The observable contract is the card: pane OPEN,
hovering the ruler leaves the ghost up and shows no card; pane CLOSED, the same
hover shows the card. Both measured, with the clock reading 0:10.2 throughout
either way.

**STILL OPEN ON THIS ITEM: the dismiss animation.** The reference opens and
closes its preview over 340ms with a `prefers-reduced-motion` path, renders the
frame BEFORE animating open so it is not one frame stale, and scrolls the
window to top because the preview and the playbar share the viewport. Our pane
is already dismissible — `previewOn`, with the pane's own close button going
through the same event so there is one owner — but it appears and disappears
without any of that. It is not built here because the pane's height is
USER-OWNED and its mount-time sizing is the subject of PL15-020, which is open
with a second contributor still unfound: animating a height that a known
intermittent bug already mis-sets is how you get a third contributor. Worth
doing after PL15-020 closes, not before.
