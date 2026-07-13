# dnd-collections architecture

This is an onboarding doc, not an API reference — read it before making a
structural change to the graph model, the drag pipeline, or the store. For
prop-level API details, see [API.md](./API.md).

The package renders collections of media/collection nodes as drag-and-drop
panels (reorder, cross-collection move, nesting, multi-drag) with full
undo/redo — built for large graphs with frequent, localized updates.

## Package layout

```
core/                       Pure, framework- and DOM-independent domain
                            logic. No React, no dnd-kit types, no DOM. If a
                            helper needs any of those, it belongs in react/.
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
  use-edge-autoscroll.ts    Deterministic edge auto-scroll for virtualized
                            containers (dnd-kit's built-in never engaged
                            for them — probed e2e).
  container-context.ts      The provider wrapper ref, for instance-scoped
                            DOM work (FLIP sweep).
  virtual-droppable.ts      Droppable-data contract virtualized containers
                            use to resolve pointer -> boundary index.
  node-views.tsx            Default views: CollectionPanels / -Panel /
                            NodeCard / NodeCardGhost. Cards receive ONLY an
                            id; everything else arrives via selectors.
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
                            fixed or metadata-driven variable widths.
  VirtualGrid.tsx           Vertical fixed-cell grid: fixed or responsive
                            column count, row-based virtualizer.
DndCollections.stories.tsx  Storybook stories; their play functions are the
                            interaction test suite (see "Testing strategy").
stories-helpers.ts          Pointer-event simulation for play functions.
core/*.test.ts              Unit tests, one file per core module.
```

E2E lives outside the package: `apps/web/tests/e2e/dnd-collections.spec.ts`
drives real trusted mouse input through Playwright against the Storybook
iframe.

## Source of truth, and the one mutation path

The committed graph is a normalized structure — `nodesById`, `childrenById`,
`parentById`, `rootIds` — and there is exactly one way it changes:

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
graph is untouched until then, exactly like a node drag.

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
the commit changes `nodesById`; the strip re-measures then (identity changes
on a commit, never on a move/drag, so it stays at commit cadence), which also
covers non-drag trims (keyboard, direct dispatch) the resizeItem path misses.
The last preview size already matches the committed size, so there is no
resize flash. An aborted drag (pointercancel, or a no-op) resets the preview.

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
- **Patches are the history and change-feed currency.** A `NodeMove` records
  pre-state `fromIndex` and post-state `toIndex`; inversion just swaps
  endpoints. The internal `applyPatch` is the single index-rewriting implementation —
  forward apply, undo, and redo all run through it, so they cannot drift
  apart. The `onChange` feed emits `{ graph, patch, origin }` per commit,
  which supports persistent partial updates downstream. Durable/external
  replay wraps a patch in a schema-versioned revision envelope and goes
  through `replayPatchEnvelope`, which validates payload, adjacency, and the
  resulting graph before advancing the caller's revision.

Roots are structural anchors: `rootIds` is not part of the patch model, and
`applyCommand` rejects any attempt to move a root (`cannot-move-root`)
rather than half-supporting it.

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
3. **Id-only card props.** `NodeCard` is `memo` and receives just `id`;
   every dynamic value (node data, selection, drag-source dimming, drop
   side, nest state) arrives through selectors returning primitives or
   stable references. A drag over one card re-renders that card alone.

This is asserted, not aspirational: cards expose `data-render-count`, and
the `RenderEfficiencyDuringDrag` story fails if a bystander card re-renders
during mid-drag pointer jitter.

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

## Keyboard: two coexisting systems

- dnd-kit's `KeyboardSensor` is restricted to **Enter** to grab/drop (arrows
  move while grabbed) — narrowed from its Enter/Space default so **Space**
  stays free for selection (native `<button>` activation → the card's
  `onClick`), which is how keyboard users select and multi-select. The
  collision code path synthesizes a pointer from the moving rect's center so
  intents still resolve without a pointer.
- The semantic layer (`core/keyboard.ts`) binds **Alt+Arrow/Home/End** on a
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
  end only" (images have no start edge).
- The card button is always a tab stop (even in handle mode, where the grip
  is a second stop for pointer/grab drag) so the selection control is always
  reachable. dnd-kit's own announcer and screen-reader instructions are
  disabled at the provider; this package speaks through one `aria-live`
  channel with human node names.

Boundary cases (already first, no adjacent collection, …) come back as
typed rejections and are announced via the aria-live region. It repeats the
same message by clearing the region and reinserting the exact text in a later
task. Assistive technology observes a real DOM change without an invisible
character becoming part of the spoken content.

Inside the virtualized views there is a THIRD arrow-key role, and the three
stay disjoint by design: **bare arrows NAVIGATE** (roving focus, in
`useVirtualRovingFocus`), **Alt+arrows MOVE**, and dnd-kit's grabbed-arrows
fire only after Enter. Navigation makes the container one `role="grid"` tab
stop and moves a focused index through the whole collection — scrolling
offscreen items in and focusing them (only the roving card is `tabIndex=0`),
with `aria-row/colcount` + per-cell indexes exposing the real position under
virtualization. It stands down while a drag is live (`isDragging`) or Alt/
Ctrl/Meta are held, so it never collides with the other two.

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
