# Punch List 15

Captured 2026-08-24 from a spoken walkthrough. Items are added as they are
dictated; each is Not started until it is worked.

## PL15-001 — Square off the left edge of the active tile's pill

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
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

- Status: Not started
- Area: `scripts/` (new), root `package.json`
- Screenshot: Not captured

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

- Status: Not started
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

- Status: Not started
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

