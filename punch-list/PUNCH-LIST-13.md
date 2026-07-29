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
