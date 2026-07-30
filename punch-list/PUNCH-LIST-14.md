# Punch List 14

Captured 2026-07-30 from a spoken walkthrough. Nothing started — every item is
Not started until the owner says otherwise. Areas are best guesses from the file
names, not from investigation.

## PL14-001 — Enable/disable an item from the details modal

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-disable-toggle.tsx` (new), `graph-item-details-modal.tsx`,
  `graph-collection-details.tsx`, `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

Both dialogs now carry a disable/enable control in the header, beside the
readout.

**An ACTION whose label flips, not a switch** — the open question, settled by
precedent rather than taste: the rail's item actions already do exactly this
(`Ban` + "Disable" / `CircleCheck` + "Enable", flipping on `allDisabled`). Two
controls for one concept should look like one concept, and the rail got there
first. Same icons, same words.

Nothing about what disabling MEANS changed: `set-node-disabled`, the item keeps
its slot and its span, playback skips it (`playback-skip.ts`).

Two things fell out of dispatching it the same way the rail does:

- **The modal's scoped undo already covered it.** `useScopedHistory` was
  written to accept `set-node-disabled` when it names exactly one node — this
  item's node — so the modal's own undo button steps through a disable with no
  further wiring. That acceptance clause predates this item; it was waiting.
- **No toast.** The rail toasts because its selection can be forty items and
  the board may not show what moved. Here the button's own label flips and the
  item is on screen, so a toast would narrate what the user is looking at.

Shared by both dialogs, for the reason PL14-010 learned the hard way: the
collection details view is a modal too, not a card surface.

Verified live and by e2e: label and `aria-pressed` flip, the card behind the
modal picks up `data-disabled` (it rides the content span, not the dnd button),
and the modal's scoped undo reverts it.

## PL14-002 — Drill-down chevron needs a hover state and the right cursor

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-content.tsx` (`CARD_CONTROL_CLASS`)
- Screenshot: Not captured

The chevron that drills into a collection item did not read as clickable. Two
separate causes, and the class already had what looked like a fix for one:

- **No cursor.** `CARD_CONTROL_CLASS` never set one, and Tailwind v4's
  preflight stopped setting `cursor: pointer` on `<button>` — so it fell back
  to the UA arrow. Verified live before the change: `cursor: default`.
- **A hover too small to see.** `hover:bg-zinc-900` over a `bg-zinc-950/80`
  base is near-black onto near-black. Now `zinc-800`, a real step at the same
  neutral temperature.

Deliberately NOT amber or sky. Amber is the selection colour (PL13-006), and
tinting a hover with it would say "selected" about a thing you are only
pointing at.

Fixed in the shared class, so it applies to every card control rather than to
the chevron alone — which is the point of PL13-005. Focus ring untouched.

Verified live: computed `cursor: pointer`, `hover:bg-zinc-800` present on the
element and the rule emitted by Tailwind.

## PL14-003 — Selected badge needs more padding from the card edges

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-content.tsx` (`CardSelectedBadge`, `CARD_CONTROL_CLUSTER_CLASS`)
- Screenshot: Not captured

The amber check badge sat 6px from the card's corner. Now 8px.

**The control cluster moved with it.** The badge is top-LEFT specifically to
mirror the cluster top-RIGHT, and the two are top-aligned — nudging one alone
would have put them 2px out of line, which is exactly what stops them reading
as a pair. Both are now 8px, and both comments say they move together.

Everything else about the badge is unchanged: still 20px against the cluster's
24px, still `pointer-events-none`, still `aria-hidden`.

Verified live on a selected card: badge `top: 8px / left: 8px`, cluster
`top: 8px / right: 8px`, both rendering at the same Y.

## PL14-004 — The modal needs a closing view transition

- Status: Complete — FIXED (an earlier pass wrongly closed this as already done)
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-details-modal.tsx`, `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

Closing was a hard cut back to the card. It now morphs, the reverse of the open.

**The modal was unmounting one render too early.** The node was read from
`openId` alone and the render guard was `if (!mounted || node === null) return
null`. Closing sets `openId` to null, so `node` went null on the very next
render and the guard removed the modal THERE — before the effect could start a
transition. The transition then ran against a page the modal had already left.

Which is why it was so easy to get wrong: the close mechanism was entirely
present and entirely observable. `withViewTransition` ran, `ready` resolved
rather than skipping, and the card took the hero name in the callback — all
true, all while the user saw a hard cut, because the "before" frame had no
modal in it.

The fix is a state change, not a new animation: the boolean `mounted` became
`mountedId`, and the node resolves from `openId ?? mountedId`. The modal now
survives the close render and is still on screen when the browser captures
"before"; the transition callback is what clears it, which is exactly when it
should go.

### Two ways this was misdiagnosed first, both worth keeping

1. **The harness lied.** Instrumenting `startViewTransition` in the automated
   browser pane showed the transition aborting with `InvalidStateError` — on
   OPEN as well as close. That pane runs the page with `visibilityState ===
   "hidden"`, and view transitions are skipped outright in a hidden document.
   View-transition work has to be verified under Playwright; the test asserts
   `visibilityState === "visible"` first so a future run cannot prove nothing.

2. **The first test passed against the bug.** It asserted a transition ran, was
   not skipped, and morphed toward the card — three true things that are all
   compatible with the modal having already vanished. The assertion that
   actually bites is `modalPresentAtCapture`: the modal must still be in the
   DOM at the moment `startViewTransition` is called, because the callback is
   what removes it. A test can be non-vacuous (this one failed when the
   transition was removed) and still miss the defect, if it measures the
   mechanism instead of the outcome.

Reported by the owner after the first pass shipped, which is the only reason it
was caught — worth remembering when a fix's evidence is all mechanism.

## PL14-005 — Move the settings icon to the icon sidebar

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-board.tsx`, `timeline-sidebar.tsx`,
  `components/timeline/sidebar-icon-styles.ts` (new),
  `lib/graph-view-events.ts`, `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

The gear moved from the breadcrumb row to the icon rail, between the trash tile
and the account one.

**Not a relocation — the menu could not simply move.** It is a radio group over
thumbnail size plus a zoom slider, and both values live in the graph's tree
(`graph-timeline-view` owns them). The rail is app chrome in a different React
tree, which is why every other rail control talks to the board through window
events.

Two ways to bridge it, and the codebase already argues for one. The event
bridge would mean publishing `itemSize` and `pixelsPerSecond` in the broadcast
state and adding two commands to move them — and that file says explicitly what
the bridge is for: *"This bridge is for the SIDEBAR — app chrome in a different
React tree — and nothing else should pay for it"*, with a precedent of NOT
adding an event when the control can render inside the graph's own tree.

So: the rail publishes an ADDRESS (`GRAPH_BOARD_MENU_SLOT_ID`) and the board
portals the real `BoardMenu` into it. The menu keeps its props and its Radix
context; only its DOM address changed. It also self-scopes — nothing portals in
when the graph is not mounted, so the slot needs no route guard and collapses
to nothing (`display: contents`) elsewhere.

(An events-based version was written first and backed out. The bridge file's own
comments are what settled it.)

Details worth keeping:

- **The trigger wears the rail's tile treatment**, so `SIDEBAR_ICON_BASE` /
  `SIDEBAR_GLYPH` / `SIDEBAR_ICON_IDLE` moved to
  `components/timeline/sidebar-icon-styles.ts` — the graph needs the styles,
  not the sidebar module.
- **`side="right"` on the menu.** End-aligned against a 72px rail it would have
  opened off-screen; the e2e asserts the menu's box stays inside the viewport.
- **The slot node is resolved in a lazy `useState` initializer, not an effect.**
  The graph tree mounts `ssr: false`, so the rail is already committed before
  the board first renders — there is no frame to retry. Doing it in an effect
  also trips the repo's set-state-in-an-effect lint, which is the same
  objection: a re-render that changes nothing. If the graph ever gains SSR this
  has to become a subscription, and the comment says so.
- A null slot fails SILENTLY (no menu, no error), so the e2e asserts the trigger
  is inside the slot, is gone from the header, and sits between Trash and
  Account.

A stale assertion in the padding test — "no button named Settings in the aside",
written when the gear was in the header — was inverted by this and now reads as
"no button named Settings anywhere", which is still true and still meaningful.

## PL14-006 — Trim drag drives the real preview when it is open

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-trim-preview.tsx` (new), `graph-trim-panel.tsx`,
  `graph-preview.tsx`, `tests/e2e/graph-view.spec.ts`.
  `packages/ui` deliberately UNTOUCHED — see below.
- Screenshot: Not captured

Preview open → the trim frame takes the pane. Preview closed → the floating
panel, exactly as before. Exactly one of the two ever shows.

**The playhead does not move.** That was round 5's condition for ever building
this, and it is why nothing here goes near `PreviewTimeChannel.set`: the clock
keeps its time, the pane's own canvas keeps rendering that time underneath, and
the frame is drawn OVER it for the length of the gesture. Release, and the
overlay unmounts onto a pane that never moved.

Three decisions worth keeping:

- **A React context, not a window event.** Both ends live inside the graph's
  own tree — the board renders as the preview component's `children` — and the
  event bridge is explicitly for the sidebar, which does not. Same rule that
  settled PL14-005 in the opposite direction.
- **`packages/ui` is untouched.** The frame is a `fixed` overlay measured
  against the pane's canvas rect, not a child slipped inside
  `WorkbenchDisplaySurface`. That surface is a generic package component with
  its own layout (the split pane sizes it, a divider drags it); putting a graph
  concern inside it would have made this a package change for a view-specific
  feature. Measuring is the technique the floating panel already uses.
- **Two effects, not one.** Publishing the frame and clearing it are keyed
  differently — the frame changes on every pointer move, "a drag is running"
  changes twice. One effect with a cleanup would set null between every pair of
  frames, remounting the `<video>`: a black flash per pointer move instead of
  a seek.

E2E covers both branches, and the assertion that matters is that the clock is
unchanged DURING the gesture — after release the trim commits and the
timeline's total duration legitimately changes, which is what the first version
of the test wrongly flagged as the playhead moving. Proven to fail with the
feature forced off.

When a video clip is selected and the user grabs a trim handle, a small overlay
preview appears above the card showing the frame at the moving edge. Add the
conditional: if the real preview area up top is OPEN, drive that surface during
the drag instead of showing the overlay. If the preview area is closed, keep
showing the overlay as it does now.

**This un-defers a decision.** The preview-area override was built up to this
point in round 5 and then explicitly deferred on the owner's instruction — the
floating overlay shipped, the override did not. This item is the owner asking
for it.

Constraint carried over from that round: commandeering the preview surface must
leave the playhead untouched — the preview shows the trim frame during the drag
and returns to the playhead's frame after, without moving the clock.

Done when: with the preview open, dragging a trim handle updates the preview
surface and no overlay appears; with the preview closed, the overlay behaves
exactly as today; the playhead does not move in either case.

### It shipped as a FACADE first, twice wrong

Two corrections, both reported by the owner, and the second is the one that
matters.

**1. Invisible.** The first version was z-30 against the pane's `sticky z-40`,
so it mounted at the right coordinates, at the right size, behind the picture
it was meant to replace. The test asserted its bounding box matched the
canvas's and passed — `boundingBox()` returns geometry regardless of occlusion.
Geometry is not visibility.

**2. It was an overlay at all.** Fixing the z-index made a facade visible
rather than making the feature right. It was a SECOND `<video>` portalled over
the pane; the pane's own canvas never learned a trim was happening. The owner
asked directly whether that was what it was, and it was.

What that actually cost, beyond the principle:

- a second decode of the same file, bypassing the pane's media cache
- the pane's transport readout describing a different moment than its own
  picture
- CSS `object-contain` only approximating the canvas's letterboxing math
- a playing pane going on playing, invisibly, underneath the still

**The real implementation is a prop.** `WorkbenchDisplaySurface` gained
`frameOverride?: {clipId, sourceTime} | null`: the pane's own canvas draws that
frame, from the element it already had cached, with its own geometry. Guarded
in `renderFrameAtTime` — one place, so the `currentTime` effect, the clip-list
effect and the playback loop all defer to it at once — and every video is
paused for the duration, since an override is a still.

`sourceTime` is in SOURCE seconds deliberately: mid-drag the clip's committed
trims are stale, so a timeline time would map through the wrong values.

The clock is untouched by construction — the prop cannot reach `currentTime`,
so a consumer cannot move the playhead through it.

**Then it was dead in the app anyway — the third correction.** The prop
addressed the frame by CLIP ID, and a clip id is not a stable handle here. The
pane plays one of two models: the focused level's projection, whose ids are
graph node ids, or the compiled manifest, whose ids are
`collectionPath:leafId` (path-qualified because leaf ids repeat across
documents). The lookup matched the projection and missed the manifest — and the
manifest is what a settled real project plays. A miss was treated as "nothing
to draw", so it failed silently.

It is addressed by `src` now, which is the same string in both models and is
what the media cache is really about. Finding a clip is an OPTIMISATION (it
makes the cache key byte-identical to normal playback's, so the override seeks
the element the pane already holds) and never a precondition — a source the
pane is not currently showing still draws, under a private key.

Nothing else is taken from the matched clip, notably not `sourceDuration`: the
manifest synthesizes that per leaf, so clamping to it would cut real frames off
a trim. The element's own duration is the true bound and `syncActiveVideo`
already clamps there.

**Why the e2e could not catch it, and what does.** The fixture never lands a
manifest, so the e2e exercises the projection alone — it passed against a
feature that did nothing in the app. `frame-override.test.ts` is the pair it
could not be: six unit cases over `resolveOverrideMedia`, including a
manifest-shaped id list. Reverting to id matching fails the manifest case.

The e2e still cannot prove the canvas paints the right frame — canvas pixels
are not readable back and the fixture's "video" is a 1x1 GIF that never
decodes. It pins that the request reaches the pane and that the floating panel
stands down. The picture needs a human with a real video.

### Three corrections on one item

Worth counting, because they rhyme: shipped invisible (z-30 behind the pane's
z-40, and the test asserted a bounding box, which is returned regardless of
occlusion); shipped as a facade (an overlay covering the pane rather than
driving it); shipped inert (matching on an id whose shape depends on which
playback model is live, verified only against the model the fixture uses).

Every one passed its tests. Every one was caught by the owner using the app.
The common thread is testing the mechanism against the harness's happy path
instead of the outcome against reality.

## PL14-007 — Right-click context menu on an item

- Status: Not started
- Area: `graph-item-content.tsx`, `graph-item-actions.tsx`
- Screenshot: Not captured

Right-clicking an item should open a context menu offering the same options the
sidebar item-actions cluster offers when an item is selected.

The actions already exist in one place (PL13-009 moved Details into that
cluster); this should present the same set rather than growing a second
definition of what an item's actions are — one source, two surfaces.

Open: whether right-clicking an UNSELECTED item selects it first (the common
convention) or acts on it without changing selection, and what the menu does
when the right-clicked item is part of a multi-selection.

Done when: right-click opens a menu with the item-actions options, driven from
the same definition as the sidebar cluster, dismissible by Escape and outside
click, and reachable by keyboard (context-menu key / Shift+F10).

## PL14-008 — An untouched, empty collection is discarded, not trashed

- Status: Complete — solved as a DISPLAY rule, not a delete rule
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `lib/trash-groups.ts`, `components/assets/trash-drawer.tsx`,
  `lib/trash-groups.test.ts`
- Screenshot: Not captured

The drawer no longer lists untouched empty collections. **Nothing about
deleting changed** — they are still ordinary trashed nodes, undo still restores
them, and emptying the bin still takes them.

**The original plan was abandoned, and the reason is worth keeping.** "Skip the
trash, just remove it" cannot be a branch in the delete path, because the thing
it would branch to does not exist: `CollectionsCommand` is exactly five cases
(`move-nodes`, `add-nodes`, `update-media`, `rename-node`,
`set-node-disabled`) and **none of them takes a node out of the graph**.
Deleting IS moving to the trash root. Implementing it as specified meant a new
`remove-nodes` command in `collections-core` — the package every surface
depends on — for one narrow case.

It also raised a question the item never asked: a collection is a node PLUS its
own timeline document. Trashing re-parents the node and keeps the document;
removing outright either orphans it in Firebase or deletes it, and "undo still
restores it" means it has to survive. That is a data-deletion decision.

So the goal was checked instead of the method — *the drawer should not fill
with shells* — and that needs no engine change, no new primitive and no
orphaned documents. The owner chose this route.

**"Untouched" is deliberately conservative**, because the two mistakes do not
cost the same: hiding something wanted back is unrecoverable from the drawer,
while showing one extra shell is untidy. Both must hold —

- `itemCount === 0`, and
- the title is still the minted `"New Timeline"` (trimmed, since a stray space
  is not a rename).

A renamed empty collection is shown, because the name IS the work. A collection
that once held content is shown, because its children travel into the bin with
it and `itemCount > 0` still reads true there.

Filtered ONCE, over the whole list, so the rows, the header count, the empty
state and the Empty Trash button cannot disagree — filtering only the rendered
rows would have left the header counting items nobody can see.

Six unit tests. Removing the title condition makes the renamed-collection test
fail, so the conservative half is load-bearing rather than decorative.

Deleting a collection that has never been changed — title never edited, holds no
items, an empty shell — removes it outright instead of moving it to the trash.
Undo still restores it.

**Delete = move-to-trash is the settled rule everywhere else**, so this is a
deliberate exception and it needs a reason that holds: the trash exists to
recover work, and an untouched empty collection is not work. Filling the drawer
with shells the user made by mis-clicking the Collection tool makes the trash
worse at the one job it has.

The load-bearing part is the definition of "untouched", and it should be
conservative — when in doubt, trash it. Both conditions together:

- no children, and
- the title is still the one it was minted with (the user never renamed it).

Anything else — a rename, a child added and later removed, arriving via undo of
a previous delete — is a collection the user did something to, and it goes to
the trash like everything else. A shell that once held content is NOT untouched.

Undo is unaffected: the delete still commits as a normal reversible patch, so
Ctrl+Z brings the collection back. Only the trash entry is skipped.

Done when: deleting a never-renamed, empty collection removes it with no trash
entry; undo restores it; a renamed-but-empty collection and an emptied-out
collection both still go to the trash; and all three paths (sidebar action,
trash drop target, Delete key) agree, because they should share one predicate
rather than three.

Open: whether the drop-on-trash gesture should also skip — dragging a shell
ONTO the trash is an explicit request to trash it, which is a reasonable case
for honouring it rather than second-guessing the user.

## PL14-009 — Breadcrumbs tint while an item is dragged

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-view-chrome.tsx` (`AncestorCrumb`), `tests/e2e/graph-view.spec.ts`
- Screenshot: Not captured

Ancestor crumbs take a faint fill while a drag is live, stepping up to a sky
tint when the pointer is actually over one.

The crumbs were already droppable and already signalled it — with a dotted
underline, and a solid sky underline when hovered. The gap was that both are
marks ON TEXT, so at a glance the trail still read as text rather than as
somewhere a card could go. A background says "region", which is what a drop
target is.

Two states, kept ranked so the stronger one still wins: `bg-zinc-800/50` for
droppable, `bg-sky-500/15` for hovered. Faint on purpose — the owner asked for
a hint that something is possible, not a highlight competing with the drop
indicator.

The existing rationale survives intact and is why this is a FILL: decoration
and background are both layout-neutral, so the crumb's width never changes as
the states toggle. A border or a ring would have moved the trail.

Pinned in the existing drop-zone e2e rather than a new test — that test already
holds a live drag over each zone, which is the only state where any of this is
visible. It asserts the droppable fill while the pointer is still on the card,
and the sky fill once it is over the crumb.

## PL14-010 — The modal's name field opens on a single click

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-details-modal.tsx`, `graph-collection-details.tsx`,
  `tests/e2e/graph-view.spec.ts` — modelled on `graph-view-chrome.tsx:103-117`
- Screenshot: Not captured

Renaming an item from its details modal takes a double click. It should take a
single click, the way the last breadcrumb crumb already works.

The two sites today, both driving the same `useInlineRename` hook:

- breadcrumb (current crumb) — `onClick={rename.begin}`, a `<button>` wearing
  `cursor-text` and `hover:bg-zinc-800/70`, labelled `Rename {name}`, swapping
  to `InlineNameEditor` on activation.
- modal title — `onDoubleClick={rename.begin}`.

So this is adopting the crumb's treatment wholesale, not inventing one: single
click, the text cursor, and the hover tint, which together are what make it
look editable in the first place. A double click with no hover affordance is
undiscoverable — nothing on screen says the title is a field.

**Why single click is available here and NOT on the cards.** Click already means
something on a card: it selects. Rename has to be the double click there, and
PL13-001 was rejected partly for trying to add a second affordance around that
conflict. The crumb has no competing meaning — it is the CURRENT location, so
clicking it navigates nowhere — and neither does a modal's title.

**Correction made while building it.** This item originally said
`graph-collection-details.tsx:128` would keep its double click, listing it with
the card surfaces. That was wrong — it is a MODAL, the collection twin of the
clip one: same `role="dialog"`, same scrim, same panel classes, same header
row. It got the same treatment, and the reasoning above is why it had to. Found
by opening a collection's modal to verify the change and seeing the old span
still there.

So: **both dialogs** open on a single click. The genuinely card-level sites —
`graph-item-content.tsx` and `graph-sub-timelines.tsx` — keep their double
click.

Both titles are now `<button>` rather than `<span>`, which also puts rename in
the dialog's tab order; F2 still works and is still the only route while focus
sits elsewhere.

Four e2e tests double-clicked these titles. They still passed afterwards — the
second click races React's re-render — but that is passing by accident, so they
now click once and locate by the new accessible name
(`getByRole("button", {name: "Rename …"})`). That locator names an element the
old markup did not have, so the tests cannot pass against it.

Verified live in both dialogs: `<button>`, `aria-label="Rename …"`,
`cursor: text`, hover class present, `tabIndex 0`; one click mounts the editor
focused with the current value selected.

## PL14-011 — The trailing slot should say how to add MEDIA, and offer a file picker

- Status: Not started
- Area: `graph-add-collection-slot.tsx`, `graph-native-drop.tsx` (expose a
  programmatic entry to `dropFiles`)
- Screenshot: Not captured

The pseudo item at the end of a timeline currently offers one thing: "Add
timeline", which mints a nested collection. It should also tell the user that
media can be added by dragging files from the file system onto any point in the
timeline, and offer a link that opens a file picker for people who would rather
browse than drag.

**This adds the app's first file-browse path.** There is no `type="file"` input
anywhere in the app today — not in the graph view, not in the assets drawer
(that drawer lists assets already uploaded). Every media item that has ever
entered a timeline arrived by an OS drag-and-drop. So this is not a shortcut to
an existing route; it is the second route.

Which makes the strongest argument for it an accessibility one, not
discoverability: **today a keyboard or switch user cannot add media at all.**
Dragging from the OS file system is not something the app can offer a keyboard
equivalent for — the gesture starts outside the page. A file input is the only
way in, and browsers already give it a fully accessible picker.

It must feed the EXISTING pipeline. `dropFiles` in `graph-native-drop.tsx` does
classification, the one-decode-per-video probe, concurrent upload with per-file
failure reporting, detail parking and a single atomic commit for the whole
selection. A picker that re-implements any of that will drift from the drop
path. The work is exposing a programmatic entry point that takes `File[]` plus
an anchor and calls `dropFiles` — the hook currently surfaces only
`commitDrop(event, anchor)`, which needs a `DragEvent`.

Two constraints that will shape the markup:

- **The slot is a `<button>` today.** A link or a second control cannot go
  inside it — nested interactive elements are invalid and this codebase has
  been bitten by exactly that before (round 6 had to use `contentEditable`
  instead of an `<input>` because the card content renders inside a button).
  The slot needs to become a container holding two controls, with "Add
  timeline" staying a button of its own.
- **Room is tight in the strip.** The slot is card height — 100px at MD — and
  already carries an icon plus an 11px label. Grid cells are much larger. The
  hint copy may need to be strip-abbreviated, or shown only at grid size, or
  moved to a `title`/tooltip on the strip. Worth deciding from a screenshot at
  both sizes rather than in the abstract.

Proposed copy, offered as a starting point rather than settled — the owner
asked me to word it:

> **Add timeline**
> or drop media files anywhere on the timeline — [browse…]

Done when: the trailing slot names both ways to add content, the browse link
opens a native file picker filtered to the supported image/video types,
selected files land through `dropFiles` (same probe, upload, failure reporting
and single undoable commit as a drop), the whole slot is reachable and operable
by keyboard, and the strip and grid presentations were both reviewed on screen.
