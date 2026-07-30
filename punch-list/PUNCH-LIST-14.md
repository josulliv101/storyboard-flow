# Punch List 14

Captured 2026-07-30 from a spoken walkthrough. Nothing started — every item is
Not started until the owner says otherwise. Areas are best guesses from the file
names, not from investigation.

## PL14-001 — Enable/disable an item from the details modal

- Status: Not started
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `graph-item-details-modal.tsx`, `graph-item-actions.tsx`
- Screenshot: Not captured

When a media item or a collection item is shown in the modal, the modal should
let the user disable or enable it.

The disable feature already exists as a play-time skip — a disabled item keeps
its slot and its span, and the player jumps it (see the `set-node-disabled`
command and `playback-skip.ts`). This item is only about surfacing that control
in the modal; it is not a change to what disabling means.

Open: whether the control reads as a toggle (switch) or as an action that flips
label between Disable and Enable. The item-actions cluster is the precedent to
match.

Done when: the modal shows the current enabled/disabled state for both card
kinds, flipping it dispatches through the same command path as the existing
action (so undo covers it), and the card reflects the change on close.

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

- Status: Complete — ALREADY IMPLEMENTED; coverage was what was missing
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: `tests/e2e/graph-view.spec.ts` (no source change)
- Screenshot: Not captured

Reported as: opening animates, closing just disappears. **Closing already runs
the same morph in reverse**, and has since PL10-008. Nothing needed fixing.

What is there: the close path calls `withViewTransition`, hands `trim-subject`
back from the modal's frame to the card inside the callback, and the CSS is
symmetric — `::view-transition-old(trim-subject)` and `-new(...)` both get
260ms with the same easing. Proven by a new e2e that asserts a transition
runs on close, `ready` RESOLVES (so it plays rather than being skipped), and
the element it morphs into is the originating card. Reverting the close path
to a plain state update makes that test time out, so it is not vacuous.

**A measurement trap worth recording.** First attempt looked like proof of the
bug: instrumenting `startViewTransition` in the Browser pane showed the
transition aborting with `InvalidStateError` — on OPEN as well as close. It was
the harness. That pane runs the page with `document.visibilityState ===
"hidden"`, and view transitions are skipped outright in a hidden document. Any
view-transition work here has to be verified under Playwright, where the page
is really visible; the new test asserts `visibilityState === "visible"` first so
a future run cannot quietly prove nothing.

Still open, since the report came from somewhere: if the close ever DOES look
like a plain disappearance, the likely cause is `cardElement()` returning null
(nothing to morph into, so the whole page cross-fades instead). Worth a look if
it recurs — with a note about which card and what had just happened.

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

- Status: Not started
- Area: `graph-trim-panel.tsx`, `graph-preview.tsx`,
  `packages/ui/timeline/viewport/workbench-display-surface.tsx`
- Screenshot: Not captured

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

- Status: Not started
- Area: the delete path shared by the sidebar action, the trash drop target and
  the Delete key; `graph-collection-details.tsx` for the "untouched" test
- Screenshot: Not captured

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

- Status: Not started
- Area: `graph-breadcrumb-drop.tsx`, `graph-board.tsx`
- Screenshot: Not captured

While an item is being dragged, the breadcrumb entries should take an ever so
slight background colour change — enough to suggest the breadcrumb area is now
a drop target for the dragged element.

The breadcrumb is already droppable; this is the missing affordance, not new
behaviour. Deliberately subtle: the owner asked for a hint that something is
possible there, not a highlight competing with the drop indicator.

Done when: the tint appears for the duration of a drag and clears on drop or
cancel, and it is distinguishable from (and weaker than) the active
drop-target treatment a crumb takes when the pointer is actually over it.

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
