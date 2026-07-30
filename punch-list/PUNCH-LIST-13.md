# Punch List 13

## PL13-001 — Collection card: checkbox + click-to-open, TRIED AND REJECTED

- Status: Rejected — reverted before commit. Kept as the record of why.
- Area: `graph-item-content.tsx`, `tests/e2e/graph-view.spec.ts` (both reverted)
- Screenshot: user mockup (3 collection cards, checkbox top-left, hover "Open",
  `0:53 · 2` bottom row)

The mockup moved selection onto a checkbox in the card's top-left and made a
plain click DRILL IN. Built, verified working, then rejected on the owner's
call — and the implementation is what produced the argument against it.

**A checkbox only earns its place when click stops meaning select.** That was
the design's whole logic: if click drills, selection needs a target of its own.
But media cards select on click and always have, so the collection card doing
something else is the inconsistency — not the thing that fixes one. With click
still meaning select, the checkbox is a second affordance for what the card body
already does, which is what round 7 rejected when it killed three controls doing
one job.

Two findings from building it, both of which argue the same way:

- **The card is out of room.** A drill button in the middle, a details trigger
  top-right, a checkbox top-left. An e2e test had ALREADY been written to click
  `{x: 10, y: 10}` to dodge the drill button, and the checkbox landed exactly
  there; the fix was hunting for a third point that was neither control. When a
  test has to search for somewhere on a card that isn't a control, the card is
  over-furnished.
- **A new control is a new class of bug.** The hover-hidden checkbox swallowed
  clicks meant for the card — `opacity-0` still hit-tests — which the e2e caught
  as "subtree intercepts pointer events". Real, and it only existed because
  there was something new to get wrong.

**What the rejection costs**, stated plainly so it is a decision and not an
oversight: discoverable multi-select. It stays on Ctrl/Cmd+click, which nobody
finds by accident. The cheap mitigations if that nags later are a shortcuts-sheet
row and the header's existing `N selected` readout — neither costs pixels on the
card.

Surviving this item, as separate work:

- **PL13-002** — click means select EVERYWHERE (the dup-ref exception).
- **PL13-003** — one representative frame instead of tiled slices.

## PL13-004 — The drill control comes off the middle of the picture

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx`
- Screenshot: Not captured (two variants were shown live before choosing)

The affordance was a circle at 34% of the card, centred at 41% height — which
put the control that navigates INTO a timeline directly on top of the frame you
would use to recognize it. Nothing belongs in the middle of a picture.

Two variants were built and looked at in the running app:

- **A — a chevron in the LABEL ROW**, artwork completely uncovered. Cleanest
  image, but it had a flaw that only showed once it was on screen: as built it
  was not a CONTROL at all, just an aria-hidden mark. And that matters more now
  than it would have an hour earlier, because PL13-001 was rejected and click
  still means SELECT — so the drill control is the only pointer path into a
  timeline. At 16px in a row of metadata it reads as punctuation.
- **B — a corner BADGE** at the artwork's bottom-right, on a translucent pill.
  Unmistakably a control, big enough to hit, clear of the frame's centre.

**B was chosen**, with ONE glyph: a chevron. It shipped briefly with two, on
the reasoning that the badge had to say "container" and "way in" at once — and
that reasoning was built on a false premise. `CollectionFolderGlyph` is not a
folder; it renders `CornerRightDown` under a misleading name. So the pair was
two direction arrows saying the same thing twice, which the owner spotted on
sight. The glyph is now `CollectionDrillGlyph`, named for what it draws, so the
next reader cannot make the same mistake. What says CONTAINER is the card, not
a second arrow.

Still a real button composed as a SIBLING of the selection surface — a button
inside the surface's button would be invalid HTML, which is why it is positioned
rather than placed — and still `tabIndex -1` with
`data-collections-keyboard-ignore`, so it stays out of the roving tab order and
out of the strip's pan surface. Keyboard drill-in is unchanged (`O`).

The offset is measured from the CARD's bottom, not the artwork's, because the
artwork is inside the surface and this is not — the label row's height is the
difference, and it differs per surface (a tight footer in the strip, a real
caption in the grid). Tuned live to the same 7px clearance above the label row
in both: `bottom-8` in the strip, `bottom-10` in the grid.

Verified: 7px clearance measured on both surfaces, app tsc clean, 485 app tests,
lint clean (5 pre-existing `<img>` warnings), graph-view e2e 95/95 — the 13
assertions that address this control by name still pass, since `Open <name>` is
unchanged.

STILL OPEN: with the badge down to a bare chevron, nothing on the card says
"container" except the item count and the border. Once PL13-003 lands a single
representative frame, check whether that reads as a collection at a glance — the
stacked-edge treatment is the fallback if it does not.

## PL13-005 — One treatment for a card's controls, both always visible

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx`, `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

The details trigger and the drill badge never read as siblings, and measuring
said why — they differed in FOUR ways at once:

| | details trigger | drill badge |
| --- | --- | --- |
| corner | `top-1 right-1` | `bottom-8 right-1.5` |
| shape | 24px square | ~28×22 pill |
| colour | zinc fill, zinc icon | zinc fill, SKY ring and icon |
| reveal | hover-revealed | always visible |

One rule now: **card controls live in ONE CLUSTER in the top-right, identical
in size, shape and fill, always visible.** The look is a shared
`CARD_CONTROL_CLASS`, the placement a shared `CARD_CONTROL_CLUSTER_CLASS` —
6px from both edges, 6px between — and a media card's single control lands in
exactly the same place (measured: 6/6 on both kinds).

The first arrangement put details top-right and the drill bottom-right,
bracketing the edge. It read as two unrelated marks, and it made the drill's
offset a per-surface tuning problem against the label row's height. A cluster
aligns them by construction and deletes that tuning entirely. The chevron sits
nearest the corner deliberately: read left to right, the mark closest to the
edge is the one that takes you past it.

**Always visible is the substantive half.** The trigger used to hide until
hover, with the hiding gated on `@media(hover:hover)` so a touch device — which
never hovers — could still reach it (PL11-011). Making both permanent deletes
that gate and the whole class of bug behind it: pointer and touch now behave
identically and there is no media query to get wrong. The cost is two standing
marks on a collection card, paid deliberately, because since PL13-001 was
rejected click means SELECT — so the drill badge is the ONLY pointer route into
a timeline, and a route nobody can see is not a route.

The bottom-right placement needed an offset measured from the CARD's bottom
rather than the artwork's — the artwork lives inside the selection surface and
the badge does not, so the label row's height was the difference, and it differs
per surface. Two hand-tuned magic numbers. The cluster removed the need for
both.

TESTS THIS MADE FALSE, both updated rather than deleted: the idle → hover → away
→ focus opacity dance is now a flat "visible at rest", and the touch test's
rationale changed — it no longer distinguishes touch from pointer, but it still
guards that the one route into the details view is reachable without hover,
which any future reveal rule would have to keep true.

Verified: 7px clearance and a shared right edge measured on both surfaces, app
tsc clean, 485 app tests, lint clean (5 pre-existing `<img>` warnings),
graph-view e2e 95/95.

## PL13-006 — Selected, as a badge on both card kinds

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx`
- Screenshot: Not captured

A tick in the card's top-left, present only while the card is selected, on
collections and media alike.

**A badge, not a control — that distinction is the whole design.** A checkbox
you click to select was built and rejected (PL13-001): with the card body
already selecting, it was a second affordance for one act, and being
invisible-but-clickable it swallowed clicks meant for the card. This one appears
BECAUSE the card is selected and does nothing when pressed
(`pointer-events-none`, so it cannot repeat that mistake), and it is
`aria-hidden` because the card already exposes `aria-pressed` and
`data-selected` — announcing "selected" twice per card is noise, not access.

What it earns: a MULTI-selection you can read. `ring-amber-300/65` is a fine
binary signal on one card and a weak one across a board of forty, where the eye
has to compare border colours. Same amber as the ring on purpose — one
selection colour, two ways of saying it.

Top-LEFT, mirroring the control cluster in the top-right, and 20px against
their 24px: a marker should not read as a button you failed to press.

The media wrapper reads selection with its own boolean selector rather than
taking it from NodeCard, which keeps it inside its own shell — and the badge has
to be a SIBLING of that shell like everything else here, since a span inside the
card's `<button>` is still inside a button. A boolean selector re-renders that
card only when ITS selection flips, not on every selection change on the board.

Verified live on both kinds (amber fill measured as `oklch(0.879 0.169 91.6)`,
`pointer-events: none`), app tsc clean, 485 app tests, lint clean, graph-view
e2e 95/95.

## PL13-007 — An empty collection shows a leader frame

- Status: Complete
- Area: `graph-item-content.tsx`
- Screenshot: user reference (a scanned academy-leader countdown frame)

The empty slot was a blank span — a dark rectangle that read as a broken
thumbnail rather than as "nothing in here yet". It shows an academy leader now:
the film industry's own mark for "before the picture starts", which is exactly
the state, and a recognizable silhouette at strip size where a label would be
too small to read.

DRAWN, not loaded. The reference was a photograph of a scanned leader with grain
and scratches; at card size the geometry is the whole message — ring, crosshair,
sweep — and the grain is invisible. A vector costs no request, stays crisp in
the grid's much larger cells, and takes the board's palette instead of putting a
bright sepia field on a near-black board. `CollectionLeaderPlaceholder` is the
one place to swap in the photograph if the texture is ever wanted.

STILL OPEN, and visible the moment it shipped: the placeholder now means TWO
things. A collection with 0 items is genuinely empty, and "before the picture
starts" is right. A collection that simply is not HYDRATED yet has content —
"Jake's Exit" reads `4:58 / 2 items` beside a leader frame — and for that one
the mark says "nothing" about something with plenty. The card already publishes
`data-collection-hydrated`, so telling them apart is cheap; what it should look
like is undecided.

## PL13-009 — Details moves off the card and into the item actions

- Status: Complete
- Area: `graph-item-content.tsx` (remove the trigger), `timeline-sidebar.tsx`
  (item-actions cluster), `graph-item-details-context.tsx`
- Supersedes: the details trigger placed by PL11-002 / PL11-012

**Take the details icon off both card kinds.** It is a per-item control living
on the artwork, and PL13-005 had just made it permanent — so every card, media
and collection alike, now carries a mark for a view most people open rarely.
That is the wrong trade, and it is also the honest answer to the
consistency question that produced PL13-005: the two kinds stop disagreeing
about where the trigger sits by not having one.

Instead: an **Edit** icon, FIRST in the rail's contextual item-actions cluster
(the Copy / Cut / Delete / More group that already appears when something is
selected). Pressing it opens the same details modal.

**Disabled on a multi-selection.** The view is about ONE item — it shows that
clip's frames, its in/out points, its name — and there is no honest way to
render it for six. Disabled, not hidden: a control that vanishes teaches
nothing, while a disabled one says "this is the wrong shape of selection for
that". PL8 has the precedent and the trap: disabled rail icons were dimmed
TWICE (zinc-600 plus opacity-50 = 1.47:1 on the near-black rail, near-invisible)
and the fix was a solid zinc-500 at 4.12:1.

Consequences to handle rather than discover:

- The card's control cluster loses a member. On a collection only the drill
  chevron remains — which is a reason to re-check whether the cluster is still
  the right shape, or whether a lone chevron wants a different home. On a media
  card the cluster empties entirely and the artwork is clean.
- `openId` in the details context is currently set by the trigger, which also
  SELECTS the card so the board's selection-scoped readouts agree with the
  modal. From the rail the selection is already the input, so that coupling can
  invert: open what is selected, and refuse when that is not exactly one.
- Several e2e tests drive the details view through the per-card trigger
  (`[data-item-details-trigger]`, the Tab-then-Enter path, the hover/touch
  reveal tests). They retarget to the rail control. The touch test in
  particular loses its subject — it exists because the trigger used to hide on
  hover-less devices, and a rail button has no such problem.

Acceptance criteria:

- No details trigger on any card.
- With exactly one item selected, an Edit control leads the item actions and
  opens that item's details.
- With two or more selected it is present and disabled, at a contrast that
  reads as available-but-not-now rather than invisible.
- With nothing selected the item actions do not appear at all, as today.

## PL13-010 — The strip should look like a strip when it is empty

- Status: Complete
- Area: `graph-board.tsx` (the strip's shell), `packages/ui/dnd-collections`
  (VirtualStrip's content box)

A strip with zero, one or two items currently reads as a couple of cards
floating on the page — the surface itself is invisible, so there is nothing to
say "things go here, in a row". Give the strip a TRACK: a background a step
lighter than the board's near-black, present whether or not anything is in it.

An empty track is also the honest empty state for this surface. The board's
other empty affordance ("Add timeline") is a slot INSIDE a row; this is the row.

Two halves, and the second is where the care is:

- **The track spans the full width**, not just the cards' extent, with a little
  inset at the trailing end rather than running flush to the viewport edge.
- **When the content is LONGER than the viewport, that trailing inset is not a
  thing** — the track continues under the cards and scrolls with them, and what
  you see on the right is simply more track. Padding at the end of a scrollable
  run would be a gap in the middle of the content as soon as you scrolled.

So the track's width is `max(viewport width − inset, content extent)`, and the
inset only ever applies in the first case. Worth checking against what already
exists there: the strip's scroller sizes its content div to
`getTotalSize()` plus the trailing-slot width (PL9), and `getTotalSize()`
deliberately stays the CARDS' extent so drops still append — so the track is a
third measurement and should not be folded into either of those.

Acceptance criteria:

- An empty strip shows a full-width track, visibly lighter than the board.
- One or two cards sit ON that track, with the remainder of it visible.
- A strip whose content overflows shows track under the whole run, and no
  trailing gap appears mid-scroll.
- The ruler, seek rail and drop indicator keep their current alignment — the
  track is behind them, and it must not shift the geometry any of them measure.

## PL13-009 / PL13-010 — what building them changed

**009 landed as specified**, with the listener in a different place than the
item guessed. It sits inside `ItemDetailsProvider`, not in the item-actions
bridge: the bridge is mounted OUTSIDE that provider, so `useItemDetails()` there
only ever sees the closed fallback. The rail sends a verb; the details feature
decides what it means and reads the selection at press time. It refuses anything
that is not exactly one item even though the button is disabled past one —
a window event carries no proof of who sent it.

`ItemDetailsTrigger` is DELETED rather than left unrendered, with a note where
it stood.

**010 turned out simpler than the item predicted**, and the reason is the whole
trick: the track goes on the scroll VIEWPORT, not the content. It then spans the
visible width whatever the content does — two clips leave the rest as visible
track, a thousand scroll over a track that stays put. No third width beside
`getTotalSize()` and the content div's own, and no trailing-gap problem, because
a viewport background cannot scroll away. The strip was explicitly
`bg-transparent` before, which is what made a short row read as cards floating
on the page. Sub-rows were `bg-black/20` — DARKER than the board, so a sub-row
read as a hole rather than a surface; they take the same track now.

E2E LESSON, and the suite already had it written down elsewhere: **a plain
`.click()` on a card can fail to select.** Press-and-hold is the drag
activation, so under load the press outlasts the 250ms threshold, becomes a
grab, and its click is correctly suppressed. `openItemDetails` retries with
`expect(async () => …).toPass()` like the rest of the suite, and asserts the
selection landed — so a failure names the half that broke instead of timing out
on a rail control that only exists once something is selected.

The two reveal tests were REWRITTEN rather than deleted: the grid one asserts
the absence of any card trigger (the state that matters now), and the touch one
asserts the select-then-Edit route works where hover does not exist — which is
what it was really protecting.

## PL13-002 — Click selects everywhere, including duplicate references

- Status: Not started
- Area: `graph-timeline-view.tsx` (`openOnClick`)

If consistency is the reason PL13-001 was rejected, this is the one place the
app still breaks it. A duplicate-reference card — media standing in for a
twice-referenced timeline — OPENS on a plain click, because it has no drill
button to do it (`openOnClick` in graph-timeline-view returns true exactly for
`duplicateOfTimelineId`). Every other card selects.

So click should select there too, and drilling into a duplicate reference goes
through the `O` key like every other keyboard drill-in — or its own control, if
it turns out one is wanted.

Acceptance criteria:

- A plain click on a duplicate-reference card selects it, like any other card.
- `O` still opens it.
- No card kind opens on a plain click.

## PL13-003 — One frame on a collection card

- Status: Complete, with the frame CHOICE still open (see the end)
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: `graph-item-content.tsx` (`useCollectionPreviewFrames`)

Independent of the interaction model, and it survives PL13-001 on its own
merits. Collection cards tile the first and last child's frames; at card size
each slot is ~80px wide — too small to recognize a face, and the crop turns a
composition into a slice of one. The item count is printed next to the duration,
so the tiles are not carrying "how many" either.

**But not the FIRST frame.** This project's own demo proves why: the "Intro"
collection currently renders "A Universal Picture" — a studio slate. First
frames are logos, black, and fades-up. Pick a representative one: the midpoint
of the collection's own duration (the preview machinery already resolves a time
to a frame for the playhead), or the first clip's midpoint as the cheaper
variant.

What the tiles were also carrying is "this is a container, not a clip". With
them gone, check whether the count, the drill button and the border treatment
say it well enough; a few px of stacked edge behind the image is the fallback
that costs far less width than a second tile.

**Media cards keep their filmstrip.** Those frames are distinct samples across
ONE clip's visible range, ending on its last frame, resampled as the card
resizes (rounds 6-7, `useSettledFrameCount`) — a duration readout, not a
contents summary.

`useCollectionPreviewFrames` returned a first/last PAIR; it returns one frame.
Everything else about the card is unchanged, and media cards keep their
filmstrip.

Acceptance criteria:

- A collection card shows one frame, filling the artwork area. ✅
- Media cards are untouched. ✅
- The frame is not the first frame of the first clip — **NOT MET.** It is the
  first child's frame, and the demo now proves the cost at full width rather
  than in a thumbnail slice: the "Intro" card is a wall of "Universal Picture".
  A representative frame (the midpoint of the collection's own duration) needs
  the preview machinery to resolve a TIME rather than take a stored poster,
  which is its own change. Logged as the open half of this item rather than
  quietly dropped.
