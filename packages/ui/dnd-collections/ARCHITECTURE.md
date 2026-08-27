# dnd-collections architecture

This is an onboarding doc, not an API reference — read it before making a
structural change to the graph model, the drag pipeline, or the store. For
prop-level API details, see [API.md](./API.md).

The package renders collections of media/collection nodes as drag-and-drop
panels (reorder, cross-collection move, nesting, multi-drag) with full
undo/redo — built for large graphs with frequent, localized updates.

## Package layout

```
core/  → NOT IN THIS PACKAGE. Pure, framework- and DOM-independent domain
                            logic, and it lives in its own package so domain
                            and server code can depend on it without pulling
                            in React: `@storyboard/collections-core`, imported
                            by subpath (`@storyboard/collections-core/graph`).
                            Listed here because it is half the architecture
                            and the diagrams below name it. No React, no
                            dnd-kit types, no DOM — if a helper needs any of
                            those, it belongs in react/.
  graph.ts                  The source-of-truth model: normalized graph
                            (nodesById / childrenById / parentById /
                            rootIds), buildGraph, branded NodeId,
                            findGraphInvariantViolation.
  commands.ts               applyCommand — the pure reducer and the ONLY
                            code that turns a command into a new graph.
                            Validates (missing node, root move, cycle,
                            same-position) and emits a reversible patch.
  patches.ts                NodeMove patches, invertPatch, applyPatch — the
                            single index-rewriting code path shared by
                            forward apply, undo, and redo.
  intents.ts                Geometry → semantics: resolveDropIntent turns
                            "pointer at (x,y) over this rect" into a
                            DropIntent; resolveCommandFromIntent turns an
                            intent into a command (post-removal index math
                            lives here, nowhere else).
  history.ts                Patch stacks. undo() returns the INVERTED
                            patch, so callers only ever apply forward.
  keyboard.ts               Semantic keyboard actions (move-prev/next/
                            home/end, nest-in-neighbor, move-out) resolved
                            into the same move-nodes command pointer drags
                            produce; plus resolveTrimCommand (Alt+Shift trim
                            -> the same update-media command the handles use).
react/
  collections-store.ts      External selector store (useSyncExternalStore).
                            Owns the committed graph + ephemeral interaction
                            state; see "The efficiency story" below.
  DndCollections.tsx        Provider wiring: dnd-kit sensors, collision ->
                            intent resolution, node-drag lifecycle,
                            DragOverlay, live region. Everything else is
                            delegated to the focused controllers below.
  use-announcements.ts      aria-live announce channel + selection-change
                            announcements.
  use-palette-drag.ts       Palette drag controller (factory at pick-up,
                            add-nodes commit, cleanup).
  use-keyboard-controller.ts Alt+key semantic moves, Alt+Shift+key media
                            trims, grid row moves (data-grid-columns scope),
                            focus restoration.
  use-edge-autoscroll.ts    Registration hook: enrolls a virtualized
                            container with the provider's edge auto-scroll
                            coordinator (dnd-kit's built-in never engaged
                            for these containers — probed e2e).
  edge-autoscroll-coordinator.ts
                            The instance's ONE pointer tracker + drag-gated
                            rAF loop serving every registered container —
                            per-view loops made one drag cost O(mounted
                            views) schedulers per frame.
  container-context.ts      The provider wrapper ref, for instance-scoped
                            DOM work (FLIP sweep).
  virtual-droppable.ts      Droppable-data contract virtualized containers
                            use to resolve pointer -> boundary index.
  node-views.tsx            Default views: CollectionPanels / -Panel /
                            NodeCard / NodeCardGhost. Cards receive ONLY an
                            id; everything else arrives via selectors.
  collection-item.tsx       Compound primitives (CollectionItem.Root /
                            SelectionSurface / DragHandle / TrimHandle /
                            DropIndicators): the full-custom escape hatch —
                            consumer-owned DOM shape (interactive controls
                            included) over package-owned behavior, delivered
                            through context. Same narrow selectors as
                            NodeCard, so the efficiency story holds.
  node-thumbnail.tsx        NodeThumbnail: image = one <img> from src; video =
                            a sequence of poster frames (never a <video>),
                            count scaling with clip length. Memoized on node.
  palette.tsx               PaletteItem external drag source.
  trash-target.tsx          TrashTarget droppable over a hidden trash root.
  use-flip-graph-animation.ts Post-commit FLIP movement animation — a layer
                            ABOVE the reducer (see below).
  history-views.tsx         UndoRedoControls + HistoryLog debug/devtools
                            views over historyEntries.
virtual/
  VirtualStrip.tsx          Horizontal virtualized strip (TanStack Virtual):
                            fixed or metadata-driven variable widths, plus
                            optional LANE ROWS under the picture.
  virtual-strip-lanes.ts    Pure lane geometry: the picture's time -> x map,
                            layer placement, row offsets, 2D roving.
  VirtualGrid.tsx           Vertical fixed-cell grid: fixed or responsive
                            column count, row-based virtualizer.
DndCollections.stories.tsx  Storybook stories; their play functions are the
                            interaction test suite (see "Testing strategy").
stories-helpers.ts          Pointer-event simulation for play functions.
                            Its unit tests live with it, one file per module
                            (`packages/collections-core/*.test.ts`), and run
                            in the same `--project=unit` pass.
```

E2E lives outside the package: `apps/web/tests/e2e/dnd-collections.spec.ts`
drives real trusted mouse input through Playwright against the Storybook
iframe.

## Source of truth, and the one mutation path

The committed graph is a normalized structure — `nodesById`, `childrenById`,
`parentById`, `rootIds` — and there is exactly one way it changes:

> `core/<name>.ts` below is a SHORT LABEL, kept because the full specifier
> would not fit the diagram. Every one of them lives in the framework-free
> `@storyboard/collections-core` package and is imported by subpath —
> `@storyboard/collections-core/intents` for `core/intents.ts`, and so on.
> There was once a `dnd-collections/core/` folder of re-export shims that made
> the short form a real path; it is gone, and the package is the only route.

```
pointer geometry                    keyboard action
      │                                   │
      ▼                                   ▼
resolveDropIntent (core/intents.ts)  resolveKeyboardCommand (core/keyboard.ts)
      │  "what would dropping here MEAN"      │
      ▼                                       │
DropIntent: insert-adjacent | nest-inside |   │
            append-to-collection              │
      │                                       │
      ▼                                       │
resolveCommandFromIntent ─────────────────────┤
      │  post-removal index math: computes the insertion index as if the
      │  moving nodes were already gone, so cross- and same-parent moves
      │  share one code path
      ▼
CollectionsCommand ("move-nodes")
      │
      ├──► commandPolicy(command, graph)  ← optional consumer veto, PRE-commit
      │      returns a rejection ⇒ stop here: no graph change, no history
      │      entry, no change event (see "Application policy" below)
      ▼
applyCommand (core/commands.ts)          ← the ONLY reducer
      │  validates: missing-node, duplicate-node-id, cannot-move-root,
      │  would-create-cycle, same-position. Sorts multi-node sets into
      │  document order, prunes descendants (a subtree moves with its root).
      ▼
{ graph', patch }                        ← patch is reversible
      │
      ├──► history.push(patch)           undo = applyPatch(invertPatch(p))
      │                                  redo = applyPatch(p)
      ▼
store.notify() → selector re-runs → only affected cards re-render
```

`move-nodes` and `add-nodes` are the STRUCTURAL commands above. There is also
one DATA command, `update-media`, for media trim/duration — media leaves
diverge into image (a single `durationSeconds`) and video (source
`fullDurationSeconds` plus `trimIn`/`trimOut`, timeline length derived by
`mediaDurationSeconds`). It flows through the exact same path: one reducer, a
reversible patch (`nodes-updated`, before/after node), undo/redo, and the
`onChange` feed — it just re-allocates `nodesById` (with structural sharing)
instead of the children arrays. The engine stays structure-only; image/video
is a leaf concern nothing else in the pipeline branches on.

That same leaf-only divergence drives how cards PREVIEW media (`NodeThumbnail`):
an image renders its single `src`; a video renders a SEQUENCE of `posterSrcs`
frames — never a `<video>` element — with the frame count scaling to clip
length (`videoFrameCount`, ~one frame per couple of seconds, capped) and the
posters cycled to fill. Missing media (image without `src`, video without
`posterSrcs`) shows a labeled fallback. `posterSrcs` is display-only metadata
like `src` — the reducer and patches never read it, so it rides through
`update-media` untouched.

The trim UI is edge handles on the card (`NodeCard trimPixelsPerSecond`),
rendered as SIBLINGS of the draggable button so a handle press never reaches
the item-drag sensor or the strip's pan. A handle drag converts pixels to
seconds, clamps, and dispatches `update-media` once on release — the committed
graph is untouched until then, exactly like a node drag. The shell/content
split applies here too: the package owns each handle's hit zone and gesture;
the pixels inside it are the `TrimHandleContent` slot, and duration readouts
are card CONTENT (`DefaultItemContent`), with live drag values delivered to
opted-in readouts over a ref-backed emitter (`useLiveTrim`) — never the
store, so bystander cards stay frozen mid-gesture.

The card resizes LIVE as the handle drags, and it does so without a graph
commit OR a full re-measure. The view (VirtualStrip) provides a `TrimPreview`
(`trim-preview-context.ts`) that the handle calls per pointer-move; the strip
implements it with the virtualizer's targeted `resizeItem`, which updates that
one item's cached size and shifts the offsets after it — O(items after the
trimmed one), not O(all). Only the ~20 mounted slot `<div>`s reconcile
(the memoized cards don't), so a live trim costs the same as a drop-indicator
move. Two constraints make it fit the render model: the provided callback is
reference-stable (ref-backed), so trim handles — which read it via context,
bypassing NodeCard's memo — don't re-render on every strip render; and the
preview never touches the store, so no bystander card re-renders. On release
the commit reconciles through the store's change feed (`subscribeToChanges`):
the `nodes-updated` patch names exactly the nodes whose widths changed, so
the strip resizes only THOSE slots (targeted `resizeItem`, commit cadence,
never a full re-measure) — which also covers non-drag trims (keyboard,
direct dispatch). Full `measure()` is reserved for `replaceGraph` (which
emits no change event — detected as a nodesById identity the feed never
saw), scale/layout prop changes, and the `remeasure()` handle. Every
duration-derived width — committed layout, live preview, measurement — runs
through one exported `durationToWidth` conversion, so the sizing layers
cannot drift. The last preview size already matches the committed size, so
there is no resize flash. An aborted drag (pointercancel, or a no-op) resets
the preview.

The LEFT handle grows the clip toward the left: its right edge stays anchored,
the left edge follows the cursor, and left neighbors slide left. `resizeItem`
alone can't do this — it keeps `offset[index]` fixed and only shifts LATER
offsets right, so growth appears on the right. So a left drag pairs the resize
with a composited **transform** on the content layer: `translateX(−(newSize −
size0))`, where `size0` is the slot size captured at drag start
(`trimBaselineRef`). Since viewport-x = contentX − scrollLeft + translateX,
the item's right edge `(offset + newSize) + translateX` stays constant while
its left edge and left neighbors move by the growth; right neighbors, shifted
by `resizeItem`, are cancelled by the transform and stay put. The shift is
derived from the live-trim state during render, so it lands in the SAME React
commit as the resize (atomic — no stutter), and it's a transform rather than a
`scrollLeft` write for two reasons: a transform isn't clamped (so shrinking a
clip at the strip start, where `scrollLeft` can't go below 0, stays consistent
instead of collapsing to a right-edge shrink), and it doesn't fire scroll
events that fight the pan/auto-scroll hooks. At COMMIT the `nodesById` effect
converts the transform into a real `scrollLeft` (`scrollLeft −= shift`) and
clears the live-trim state, so removing the transform doesn't jump the clip —
seamless where there's scroll room, a small snap where there isn't (the known
native-scroll limit). An abort just clears the live-trim state (transform → 0,
scroll untouched → revert). Gated to the left handle on a non-first item;
index 0 keeps grow-right. The right handle is unchanged (grows right, left edge
anchored, pure `resizeItem`).

For a selected video, `VirtualStrip` also renders a `TrimOverviewStrip`
(`trim-overview.tsx`) — the full source as a poster filmstrip with an amber
window marking what's showing — as a floating TOOLTIP directly above that
clip. It's an OVERLAY, not part of the row: it reserves no vertical band, so
showing it never displaces the clips. To float above the row without being
clipped it's rendered OUTSIDE the scroll container (an `overflow-x: auto`
element also clips vertically, so a child above the row would be cut off),
in a `relative` wrapper. `VirtualStrip` positions it imperatively — a layout
effect (each render) and an rAF-coalesced scroll listener read the selected
clip's live `getBoundingClientRect()` and set the overlay's `translateX` to
`clipLeft − trimInSeconds * pixelsPerSecond`. Reading the clip's actual rect
(which already reflects scroll, padding, and the live-drag transform) makes
the amber window's left/right edges land EXACTLY on the clip's rendered edges
for any trim value, with no coordinate math to keep in sync. `TrimPreview`
(widened to `previewTrim`) carries the drag's live `trimInSeconds`/
`trimOutSeconds` split (not just the resulting duration) so this holds mid-drag,
not only after commit; `VirtualStrip` keeps that live override in interaction
state local to the view (not the store, so bystander cards don't subscribe)
and clears it whenever `nodesById` changes identity (any commit — trim, undo,
redo).

A trimmed video at index 0 is the one case the overview can't reveal by
scrolling: its offset is 0 with no content (and no scroll room) to its left,
so the trimmed-in room would sit left of the origin. When such a clip is
selected, the virtualizer's `paddingStart` reserves a leading gutter (its
committed `trimIn * pps`) that insets the first clip so the room fits — a
horizontal fix orthogonal to the tooltip's vertical float. It's transient
(present only while that first item is selected) and uses the COMMITTED
trim-in, so it changes at selection/commit cadence, never per drag frame.

The overview is itself interactive, sharing the card handles' gesture core
(`trim-gesture.ts`: `resolveTrim`, `resolveMove`, `useTrimPointerDrag` — one
pointer lifecycle → live `previewTrim` → one `update-media` on release). Its
amber grips TRIM (left = trim-in, right = trim-out) exactly like the card
edges. Dragging the filmstrip body instead MOVES the source window:
`resolveMove` shifts trim-in and trim-out together, keeping showing (and so the
clip width) constant. Because the overlay is placed at `clipLeft − trimIn*pps`,
the window (which sits `trimIn*pps` in from the overlay's left) stays on the
clip's left edge for any trim-in, while the filmstrip around it slides — so a
move scrubs which part of the source the clip plays without moving the window
or the clip. A move carries `side: "move"`, which the left-grow anchor ignores
(effective is unchanged, so its transform is 0 anyway). The overview lives
outside the scroll container, so its drags never reach the strip's pan gesture.

Two properties fall out of this shape and everything else depends on them:

- **The committed graph is never touched during a drag.** The live preview
  (drop indicators, nest highlight, invalid overlay) is interaction state in
  the store — a `DropIntent` plus a precomputed `dropIntentInvalid` flag.
  Only the drop dispatches a command. This is also why the package does NOT
  use dnd-kit's `useSortable`: its multi-container pattern mutates list
  state inside `onDragOver`, which would put preview churn into the source
  of truth and make "cancel" a restore operation instead of a no-op.
- **Patches are the persistence and history currency.** A `NodeMove` records
  pre-state `fromIndex` and post-state `toIndex`; inversion just swaps
  endpoints. `applyPatch` is the single index-rewriting implementation —
  forward apply, undo, and redo all run through it, so they cannot drift
  apart. The `onChange` feed emits `{ graph, patch, origin }` per commit,
  which is what makes persistent partial updates possible downstream.

Roots are structural anchors: `rootIds` is not part of the patch model, and
`applyCommand` rejects any attempt to move a root (`cannot-move-root`)
rather than half-supporting it.

### Hydration: IO landing, outside the mutation path

Lazy-loaded data enters the graph through exactly one seam that is
deliberately NOT a command: `store.hydrate(collectionId, specs)` (pure core:
`hydrateCollection`) fills an EMPTY collection — a placeholder standing in
for a document that hadn't loaded yet — with a denormalized subtree. It sits
between `initialGraph` (initial-only) and `replaceGraph` (wholesale swap
that must clear history):

- **Undo/redo survives — with a replay guard.** Hydration only ADDS nodes
  under a childless collection, so history almost always still replays. This
  is what lets an app keep ONE provider (one graph, one undo stack) alive
  across drill-in navigation while documents hydrate on focus. But "almost":
  hydration can install an id a dormant redo also wants to add (one node in
  two collections), or fill a collection whose add a dormant undo would
  remove (orphaned children) — both were reproduced as invariant violations.
  So `undo()`/`redo()` run each entry through `verifyPatchApplies` first; a
  refused entry drops its whole side of history (entries replay in order —
  an inapplicable top makes everything beneath unreachable) and returns
  false. `applyPatch` itself stays validation-free; the GUARD is at the
  replay boundary, which is the only place patches meet a graph that may
  have grown since they were recorded.
- **Invisible to history and the change feed.** No history entry (undoing
  "the data loaded" is nonsense) and no `onChange`/`subscribeToChanges`
  event (the data came FROM storage; echoing it back invites write loops —
  same reasoning as `replaceGraph`). Snapshot subscribers are notified so
  views re-render; data-sized virtual views detect the feed-less graph
  change through their `replaceGraph` path and re-measure.
- **Placeholders only.** A non-empty target is rejected
  (`collection-not-empty`) — merging into populated collections is app
  policy the engine refuses to guess at. Id collisions with the host graph
  are rejected before anything merges.

### Application policy: vetoes belong BEFORE the commit

The reducer validates graph-level truths (does the node exist, would this
create a cycle). It cannot see application state — most importantly whether a
placeholder collection's document has actually loaded. That gate is the
optional `commandPolicy` the provider forwards to the store: it runs inside
`dispatch`, before `applyCommand`, and a rejection stops the pipeline dead.
The consumer gets a typed `blocked-by-policy` rejection back and the package
flashes the involved cards and announces the policy's message.

It has to be pre-commit, and the reason is not stylistic. The obvious
alternative — let the command commit, inspect the resulting patch in an
`onChange` subscriber, call `store.undo()` if it violates policy — restores
the graph but silently corrupts history. `history.push` clears the redo
branch, so by the time the subscriber runs, whatever the user had left to
redo is already gone; the undo then pushes the REFUSED command onto the redo
stack, where redoing it replays the very move that was just rejected. The
graph looks right and the history is wrong, which is the worst shape a bug
can take. If a new rule needs to refuse a command, it goes in the policy.

## The efficiency story

The target workload is a huge graph where a drag is a per-frame event
stream. The design answer has three layers:

1. **Structural sharing in the reducer.** `applyPatch` re-allocates only the
   children arrays a move actually touched; every other array keeps its
   identity. `nodesById` is never re-allocated by moves at all.
2. **An external selector store, not React context.** Context would
   re-render every consumer per change. `useCollectionsSelector` re-runs
   selectors on notify but React bails when the result is `Object.is`-equal
   — and thanks to (1), unaffected slices ARE equal. The store upholds its
   half of the contract: snapshot fields keep their identity unless they
   changed (`historyEntries` is cached and refreshed only on
   dispatch/undo/redo — never rebuilt per interaction notify), and
   no-op updates (`setSelection` with the same set, an unchanged
   `DropIntent`) don't notify at all.
3. **Id-only card props.** `NodeCard` is `memo` and receives just `id`
   (plus identity-stable configuration); every dynamic value (node data,
   selection, drag-source dimming, drop side, nest state) arrives through
   selectors returning primitives or stable references. A drag over one
   card re-renders that card alone.
4. **A shell/content component boundary.** `NodeCard` is a visually
   TRANSPARENT interaction shell — it owns behavior and geometry (drag/drop
   wiring, selection, aria, trim handles, indicators, the card box) and
   paints nothing. Pixels come from a memoized content component
   (`DefaultItemContent`, or a consumer's via the provider `components`
   registry / per-view `itemContent`), rendered with the node plus
   rarely-changing primitives only. Because the optimization is the
   component boundary — not the shell's hooks — consumer content inherits
   the whole efficiency story for free, and a consumer's own store
   subscriptions re-render only their content, never the shells. Content
   components must be identity-stable (module scope): a new component type
   per render REMOUNTS every card's content subtree.

This is asserted, not aspirational: cards expose `data-render-count`, and
the `RenderEfficiencyDuringDrag` story fails if a bystander card re-renders
during mid-drag pointer jitter — `CustomContentRenderEfficiency` repeats the
assertion with consumer content and a consumer-owned external store, in both
directions.

## dnd-kit integration decisions

dnd-kit supplies sensors, the collision loop, and the `DragOverlay` ghost.
Everything semantic happens in `core/`.

- **Intent is computed inside `collisionDetection`** because that is the
  only dnd-kit callback that receives pointer coordinates. The resolved
  intent is parked in a ref and published to the store from
  `onDragMove`/`onDragOver` (which fire immediately after).
- **Collision strategy: `pointerWithin`, falling back to `closestCenter`.**
  Pointer-priority first so hovering an empty panel can't lose to a nearer
  card elsewhere; the fallback exists because `pointerWithin` returns
  nothing in gaps, and `closestCenter` alone (no distance cutoff) would
  always find "some card, somewhere".
- **Gap drops insert between cards, not at the end.** A pointer in the gap
  between two cards is inside the panel droppable but over neither card, so
  the panel wins collision — but that must not read as "append". The
  collision code hands `resolveDropIntent` the panel's child-card rects
  (`panelChildRects`), and the panel branch resolves a pointer sharing a
  row with some card to insert-adjacent against the nearest one (dragged
  cards excluded as anchors — they sit dimmed in place). Vertical
  whitespace below or between rows still means append-to-collection.
- **Only the exact dragged ids are filtered out of the droppable set.**
  Descendants of a dragged collection remain hoverable on purpose: hovering
  one resolves an intent the store flags invalid, which drives the visible
  "Cannot drop (cycle)" preview instead of dead silence. Validity is
  computed once per intent change — and by the same rule the reducer
  enforces at commit, so the preview can never disagree with the drop's
  outcome.
- **Multi-drag** is the selection when the pressed card is in it, else just
  the pressed card (`store.beginDrag`). The dragged cards stay in place,
  dimmed; the `DragOverlay` ghost carries a "+N" badge. The reducer sorts
  the set into document order and prunes ids whose ancestor is also moving.

## Pointer arbitration on a pannable surface

A `VirtualStrip` with `panToScroll` on has three gestures competing for one
horizontal drag, and the rule between them is that **panning is the default
and everything else has to declare itself**:

- **Item drag.** From a grip bar it activates on distance; from a card body
  in `itemDragActivation="hold"` it needs a still press of 250ms, and a fast
  move cancels the pending activation and hands the press to the pan
  (`CollectionsPointerSensor`).
- **Trim.** A press on a handle publishes its zero-delta preview at once — it
  shows a frame, which is not the same as beginning an edit — but does not
  become an edit until it has settled for `TRIM_ARM_DELAY_MS` (200ms). Move
  past `HOLD_DRAG_TOLERANCE_PX` first and the trim drops itself and the pan
  takes over, one pixel later at `PAN_START_SLOP_PX`; those two constants are
  defined one apart so the handoff can never leave both live or neither.
  Arming sets `data-trim-armed` on the pressed element (content styles off it
  through the hit zone's `group/trim`) and claims the pointer, which the pan
  reads through `isGestureClaimed` and stands down for.
- **Pan.** Anything else, past the slop.

The dwell exists because trim handles are 8px at each clip edge and always on
with a mouse, so in a strip where clips sit flush every cut carries a 16px
band where a pan silently became an edit — the first thing that shipped here
that could destroy work by accident. Which surfaces owe the dwell is asked of
the DOM (`PAN_SURFACE_ATTR`, written by the view that installs the pan hook),
not passed down: a handle in a panel or a grid has nothing to arbitrate
against and keeps instant trims, and so does the overview panel, which floats
outside the scroller. Coverage is
`GestureArbitration.stories.tsx` plus a trusted-mouse e2e test, since the
handoff runs across two independent listener sets and a real pointer capture.

## Click arbitration and the interaction policy

A card's `onClick` only ever sees the residue the gesture pipeline leaves
behind, and three mechanisms guarantee it:

- **An activated drag suppresses its trailing click.** dnd-kit adds a
  capture-phase document click listener the moment activation constraints
  are met — including a press-and-hold grab released WITHOUT moving, so
  "click-and-hold" is cleanly distinct from "click".
- **A pan squashes its own click** (`use-pan-with-momentum`): after a real
  pan, a one-shot capture listener eats the click inside the container.
- **The pan captures the pointer only once the press BECOMES a pan** (past
  the slop). Capturing at pointerdown retargets pointerup to the container,
  and the browser then fires the compatibility click at the container
  instead of the pressed card — which silently ate every stationary card
  click on pannable surfaces. (This exact bug shipped; the graph view's
  e2e interaction-model test guards it with trusted input.)

What the surviving click MEANS is the provider-level interaction policy
(`react/interaction-policy.ts`, configured via `clickSelection` /
`onOpenNode` / `openOnClick` / `trimRequiresSelection` on
`<DndCollections>`): replace-or-toggle selection, click-to-open for
collections (pointer clicks only — keyboard Space always selects, so the
grammar below is untouched; Ctrl/Cmd+click always selection-toggles, which
is also how open-targets join a multi-drag), and selection-gated trim
handles. One shared grammar covers both card shells (`NodeCard` and the
`CollectionItem` primitives); coverage lives in
`InteractionPolicy.stories.tsx`.

## Keyboard: two coexisting systems

- dnd-kit's `KeyboardSensor` is restricted to **Enter** to grab/drop (arrows
  move while grabbed) — narrowed from its Enter/Space default so **Space**
  stays free for selection (native `<button>` activation → the card's
  `onClick`), which is how keyboard users select and multi-select. The
  collision code path synthesizes a pointer from the moving rect's center so
  intents still resolve without a pointer.
- The semantic layer (`@storyboard/collections-core/keyboard`) binds **Alt+Arrow/Home/End** on a
  focused card — deliberately outside the sensor's grammar so the two never
  clash. It's wired by event delegation on one wrapper div (no per-card
  handlers), resolves to the same `move-nodes` command as pointer drags
  (shared validation, history, announcements), and restores focus after
  cross-parent moves — retried across frames, with the destination collection
  as a fallback when the card lands somewhere this view doesn't render.
- Adding **Shift** to that chord TRIMS instead of moving: **Alt+Shift+Arrow**
  on a focused media card is the pointer trim handles' semantics without a
  drag (`resolveTrimCommand` → the same `update-media` command). Horizontal
  arrows work the END edge every media has (→ lengthens, ← shortens: image
  duration, or video trim-out); vertical arrows work the video START edge (↑
  trims more off the start, ↓ gives it back — trim-in). One keypress steps 1s,
  clamped by the reducer exactly like a drag; a step the reducer clamps to no
  change comes back as `same-position` and is announced as a boundary. The
  trim branch is checked before the move/grid logic so a held Shift never
  falls through to a move, and a trim keeps the card mounted, so focus stays
  put (no restore needed). Alt+Shift+↑/↓ on an image announces "trimmed at the
  end only" (images have no start edge). **Alt+Shift+Home/End** slide a
  video's source window (trim-in/out together, showing duration constant —
  the overview filmstrip drag's keyboard equivalent, `resolveWindowMoveCommand`),
  closing the last pointer-only trim operation.
- The card button is always a tab stop and always carries the KEYBOARD grab
  (Enter) — in handle mode the grip is a pointer-only second stop, so the
  instructions' "Press Enter to pick it up" stays true in every mode,
  including roving virtual views where the grip is `tabIndex=-1`. dnd-kit's
  own announcer and screen-reader instructions are disabled at the provider;
  this package speaks through one `aria-live` channel with human node names,
  including MID-DRAG target feedback ("Over \"Panel B\".", "— cannot drop
  (cycle).") whenever the destination collection or its validity changes, so
  a keyboard grab-drag is never blind between pick-up and drop.

Boundary cases (already first, no adjacent collection, …) come back as
typed rejections and are announced via the aria-live region. It repeats the
same message by clearing the region and reinserting the exact text in a later
task. Assistive technology observes a real DOM change without an invisible
character becoming part of the spoken content.

The announce channel is a ref-backed EMITTER and the live region is its own
leaf component (`LiveAnnouncementRegion`) — announcement state must never
live in the provider, whose re-render reaches every card through dnd-kit's
internal context and would break the no-bystander-re-render guarantee each
time something is spoken (the mid-drag announcements above made this
load-bearing; `RenderEfficiencyDuringDrag` catches regressions).

Inside the virtualized views there is a THIRD arrow-key role, and the three
stay disjoint by design: **bare arrows NAVIGATE** (roving focus, in
`useVirtualRovingFocus`), **Alt+arrows MOVE**, and dnd-kit's grabbed-arrows
fire only after Enter. Navigation makes the container one `role="grid"` tab
stop and moves a focused index through the whole collection — scrolling
offscreen items in and focusing them (only the roving card is `tabIndex=0`),
with `aria-row/colcount` + per-cell indexes exposing the real position under
virtualization. It stands down while a drag is live (`isDragging`) or Alt/
Ctrl/Meta are held, so it never collides with the other two.

With LANE ROWS the strip becomes a stack of rows, and navigation goes 2D
over one flat list spanning them — so the grid still has a single tab stop.
The resolver (`resolveLaneStripIndex`) clamps WITHIN a row, because the hook
clamps globally and an unclamped step off the last shot would silently land
on the first layer card. Up/Down cross rows at the nearest time, preferring
the window that CONTAINS the current card's start. On a single-row strip
vertical arrows return null rather than the current index: returning it
would have the hook `preventDefault` a key it did nothing with, and vertical
arrows are how the page scrolls with the pointer over a strip.

## Lane rows: why the consumer owns the clock

Layers are positioned by TIME, which means the strip needs a time -> x map
for the picture row. It does not derive one. Its own notion of duration
knows nothing about the gap a document packs between clips (0.12s in this
repo) or the span a collection card stands for, so a clock derived from
widths drifts by one gap per gutter — a few pixels per card, and a bed
visibly sliding off the shots it covers by the tenth one. The consumer
already has the real times; it passes them as `itemTimes` and the strip
pairs them with the widths it measured.

The map is therefore piecewise linear and anchored on card EDGES: at a
card's start time it returns that card's left edge exactly, and it
interpolates across the gutter between two cards rather than snapping. A
layer card's width is both its edges through that map, not
`durationToWidth` — which is only right on a linear axis and would leave a
bed short by one pack gap per shot it spans.

A lane is NOT bounded by the picture's cuts, and the map reflects that in
both directions. A card's start is arbitrary — it may begin inside one shot
and end inside another, and two cards on one lane need neither touch nor
tile — so nothing here assumes alignment or ordering among layer items.
Past the last picture card the map extrapolates at that card's rate instead
of clamping, because a lane can outlast the picture; clamping drew a 30s bed
under a 12s cut as though it ended with the cut. Before the first card it
still clamps, since content coordinates start at 0.

Lanes stop at geometry HERE, but not in the engine. `trackIndex` and
`placedStart` are node fields, changed through `set-node-placement` — the
same shape as `disabled`, and for the same reason: they are DOMAIN facts the
engine carries and never interprets, and putting them behind a command is
what makes them ride the patch path and undo. The side-table rule is "does
the engine MUTATE it", not "does the engine understand it".

Dragging onto a lane goes through the SAME pipeline as everything else, with
one extra target shape. A row registers a `VirtualPlaceTarget` resolving to a
lane and a time — a boundary index means nothing where clips are positioned by
their own start — the provider forms a `place-at-time` intent, and
`resolvePlacementCommand` turns it into `set-node-placement`. It is not a move,
so it does not go near the post-removal index math and does not consult
`mapDropCommand`: that seam corrects a BOUNDARY whose meaning a view changed,
and a lane and a time mean the same thing everywhere.

Collision precedence gained two rules, both extending "a card beats a
container" and for the same reason (pointerWithin ranks by distance-to-centre
with no notion of z-order): a ROW beats the strip container, and CROSSING a row
beats a card. The second is what lets a bed be dragged up onto the picture
anywhere on that row rather than only through a gutter; within one row a card
still wins, so reorder is untouched.

A consumer that splits its children by lane is still handing the strip a
FILTERED item source, so ordinary inserts keep needing the `mapDropCommand`
translation a flat strip uses.

## FLIP animation: a layer above the reducer

`use-flip-graph-animation.ts` animates committed moves (drop/undo/redo). It
visualizes graph changes; it never decides them.

It has to be a **single instance-wide sweep** rather than per-card effects,
and the reason is the efficiency story above: displaced sibling cards
intentionally don't re-render, so a per-card effect would never fire for
exactly the cards that shifted. Instead, one component (`FlipAnimator`,
mounted by the **provider**) measures the DOM directly and plays
inverted-transform WAAPI animations. Each graph commit explicitly cancels the
instance's in-flight FLIP animations before starting replacements. Rects
match by DOM-element identity first; when React recreates a card during a
cross-parent move, node identity is used only if one unmatched instance
exists on each side. This preserves cross-panel animation without conflating
two views that render the same node.
`prefers-reduced-motion` disables it; so does `animateMoves={false}` on
`<DndCollections>`.

Ownership sits at the **provider**, not on any one view (`animateMoves` is a
`<DndCollections>` prop). That is what makes it a true system layer: one sweep
per commit animates panels, virtualized views, and custom views alike, and two
views in one instance never each run their own sweep. Grid cross-row moves do
recreate the element, but the unambiguous node fallback still animates the new
card from the old rect. Any `[data-node-id]` under the provider container is
measured.

**FIRST and LAST are measured in the same scroll frame.** FIRST is captured
synchronously the instant the graph changes — inside a `store.subscribe`
callback that runs during dispatch/undo/redo, before React re-renders, while
the DOM still shows the pre-commit layout — and LAST is measured in the
`useLayoutEffect` after the re-render. Both reads happen within one
synchronous task, so no scroll can interleave. (An earlier version stashed
FIRST at the *previous* commit's layout effect in viewport coordinates; any
page or container scroll between two commits then leaked its delta into every
card, sliding the whole board by the scroll amount on the next commit —
`FlipSurvivesScrollBetweenCommits` guards against the regression.) The
subscription is gated on graph identity, so the flood of interaction-only
notifies during a drag never triggers a measurement.

The sweep is scoped to the provider's wrapper element, exposed through
`container-context.ts` — both the DOM query and the rect registry stay inside
one `DndCollections` instance, so multiple boards on a page
(even ones reusing node ids) never measure or animate each other's cards
(`TwoInstancesStayIsolated` story).

Accepted gap: within an instance, a panel that merely shifted because a
sibling panel grew will animate its cards too — but content outside the
container never does.

## Testing strategy

Four layers, each catching what the previous can't:

1. **Unit tests (`core/*.test.ts`)** — pure-function coverage of the graph,
   reducer, patches, intents, history, and keyboard resolution, including
   every rejection reason and the invariant checker's violation taxonomy.
2. **Story play functions (`DndCollections.stories.tsx`)** — the interaction
   suite, run in real Chromium via the Storybook/Vitest addon. Simulated
   pointer events MUST set `isPrimary: true` (PointerSensor silently ignores
   non-primary pointers) and use a single `userEvent.setup()` session when a
   held modifier spans multiple clicks (the static API resets keyboard state
   per call). Both are load-bearing; both are documented at the source.
3. **Playwright e2e (`apps/web/tests/e2e/`)** — real trusted mouse input,
   which is the only way to exercise `PointerSensor` exactly as users do.
   **Trap: e2e must target play-less stories.** A story's play function
   auto-runs when the iframe loads, and its synthetic `pointerup` will end
   Playwright's trusted drag mid-flight (this exact bug cost a diagnosis
   session — see `CycleFixture`, the play-less twin of `CycleRejectionFlash`).
4. **Assertable efficiency** — `data-render-count` probes turn the
   no-bystander-re-render claim into a failing test rather than a comment.
