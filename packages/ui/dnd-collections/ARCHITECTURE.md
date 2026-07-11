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
                            produce.
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
  use-keyboard-controller.ts Alt+key semantic moves, grid row moves
                            (data-grid-columns scope), focus restoration.
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
- The card button is always a tab stop (even in handle mode, where the grip
  is a second stop for pointer/grab drag) so the selection control is always
  reachable. dnd-kit's own announcer and screen-reader instructions are
  disabled at the provider; this package speaks through one `aria-live`
  channel with human node names.

Boundary cases (already first, no adjacent collection, …) come back as
typed rejections and are announced via the aria-live region — which nudges
repeat messages with a zero-width space so identical announcements still
fire.

## FLIP animation: a layer above the reducer

`use-flip-graph-animation.ts` animates committed moves (drop/undo/redo). It
visualizes graph changes; it never decides them.

It has to be a **single instance-wide sweep** rather than per-card effects,
and the reason is the efficiency story above: displaced sibling cards
intentionally don't re-render, so a per-card effect would never fire for
exactly the cards that shifted. Instead, one component (`FlipAnimator`)
measures the DOM directly and plays inverted-transform WAAPI animations
(`composite: "replace"` so a rapid undo/redo supersedes an in-flight
animation instead of compounding). The id-keyed rects span the whole
container, which is what makes cross-panel moves animate — a card's FIRST
rect is taken from its old panel. `prefers-reduced-motion` disables it; so
does `animateMoves={false}` on `CollectionPanels`.

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
`container-context.ts` — both the DOM query and the id-keyed rect registry
stay inside one `DndCollections` instance, so multiple boards on a page
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
