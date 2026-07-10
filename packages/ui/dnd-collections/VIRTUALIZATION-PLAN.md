# Virtualized collections — gap analysis and build plan

Target: the "Virtualized Collections Requirements" spec (horizontal strip +
vertical grid over TanStack Virtual, 1,000+ nodes, variable widths, external
palette, trash). Reference: TanStack `react-virtual`
(https://github.com/TanStack/virtual/blob/main/packages/react-virtual/src/index.tsx).

Ground rule: `core/` already satisfies most of the spec and stays the
engine. Virtualization is a NEW VIEW LAYER (`virtual/` alongside `react/`),
plus two deliberate core extensions (virtual-index intents, add-node
command). Do not fork the reducer/patch model.

## What the spec already gets from dnd-collections

- §2 Data model: all bullets. "Hidden collections" = roots not passed to
  the view (`collectionIds` prop already does this); trash is just a
  hidden root.
- §3 Node types: media/collection nodes exist; image-vs-video is a
  `MediaNode` rendering concern (`src`, add `mediaKind` field if needed).
- §8/§9 card semantics, §10 DnD semantics (multi-drag doc-order, subtree
  pruning, forward/backward index math, cancel/preview/commit/reject),
  §13 intents (all but virtual-index and trash — trash = append-to-
  collection targeting the trash root), §17 selection (range selection is
  the one gap; implement with `getDocumentOrder`), §19 animation (FLIP
  sweep only touches mounted DOM — exactly the "no requirement to animate
  unmounted items" carve-out), §20 announcements/keyboard (extend, don't
  replace).
- §12 Trash: pure modeling. Designated trash root, excluded from
  rendering; trash = move-nodes into it (subtrees ride along), restore =
  move out. Undo/redo free. No delete command until "permanent delete" is
  actually requested.

## The genuinely new work

1. **Virtual-index intents (core extension).** Today's gap resolution and
   indicators read mounted card rects. Virtualized, most cards don't
   exist — intents must come from the virtualizer's layout math
   (offset → index), not the DOM. Add a
   `{ type: "insert-at-index"; collectionId; index }` intent (the spec's
   "insert at virtual index"); `resolveCommandFromIntent` already thinks
   in indexes, so the mapping is trivial. Collision detection over a
   virtualized container targets the CONTAINER and computes the index
   from pointer offset + virtualizer measurements — O(log n) via
   `getVirtualItemForOffset`, never a DOM scan (§18).
2. **Add-node command (core extension).** Palette drops create nodes; the
   patch model only knows `nodes-moved`. Add `add-nodes` command and an
   `AddNode` patch variant (invert = remove). Touches `CollectionsPatch`,
   `invertPatch`, `applyPatch`, history, `onChange` — keep it one PR with
   round-trip tests, since every layer pattern already exists.
3. **`virtual/` view layer.** `VirtualStrip` (horizontal) and
   `VirtualGrid` (vertical, lane = index % columns) on
   `useVirtualizer`. Cards reuse `NodeCard` internals (id-only props,
   selector subscriptions — virtualization changes WHICH ids render, not
   how a card works). Drop indicator = absolutely-positioned line at the
   virtualizer offset for the resolved index, so it needs no neighbor
   cards mounted (§14).
4. **Measurement/width cache (§5).** `estimateSize` from metadata
   (aspect/duration), `measureElement` after mount, cache keyed by node
   id OUTSIDE the virtualizer so unmount/remount doesn't re-measure;
   invalidate on metadata/zoom/container-size change. Media-strip's
   `useMediaStripVirtualizer` + task #18/#37 learnings are the porting
   source — including scroll-anchor stability after width updates.
5. **Grid keyboard (§7/§16).** New `keyboard.ts` actions `move-up`/
   `move-down` = index ± columnCount → same move-nodes command. Focus for
   offscreen targets: `scrollToIndex`, then focus after mount (the
   focus-restore rAF pattern in DndCollections.tsx generalizes; may need
   a retry-until-mounted loop).
6. **Auto-scroll (§15).** dnd-kit's built-in autoScroller handles
   scrollable containers; verify intents recompute during scroll-without-
   pointer-move, and reuse media-strip's shared autoscroll helper if the
   built-in fights the virtualizer.

**Decided (user, 2026-07-10):** variable width applies to the HORIZONTAL
strip only. Grid cells are fixed-size, media letterboxed inside — rows
stay uniform, the grid virtualizer stays row-based, and the §5
measurement/width-cache machinery is a strip-only concern (phase 4
touches `VirtualStrip` alone).

## Known traps (already paid for once)

- Droppables unmount mid-drag while auto-scrolling; intents must degrade
  to container + virtual index, never depend on a target card staying
  mounted.
- Playwright must target play-less stories; simulated pointers need
  `isPrimary: true`; drags need a settle dwell.
- Keep the FLIP sweep instance-scoped and mounted-only; never enumerate
  virtual items for animation.

## Phases (each independently shippable + testable)

1. ~~`insert-at-index` intent in core + tests (no UI yet).~~ DONE
   (2026-07-10): intent variant + `intentDestination`/`isIntentInvalid`
   coverage, visible-boundary → post-removal conversion in
   `resolveCommandFromIntent`, store `intentEqual` case, 5 unit tests.
2. ~~`VirtualStrip` read-only: 1,000 items, selection, offscreen focus +
   scroll-into-view. Stories + e2e scroll test.~~ DONE (2026-07-10):
   `virtual/VirtualStrip.tsx` (fixed-width items, stable node-id keys,
   `VirtualStripHandle.scrollToNode/focusNode` with retry-until-mounted
   focus), exported from index.ts. 3 stories in
   `VirtualStrip.stories.tsx` (+ play-less `VirtualPlayground` for e2e)
   and a real-wheel-scroll e2e test.
3. DnD in `VirtualStrip`: container-collision → virtual index, offset
   indicators, auto-scroll, cross-strip moves. e2e: drop across scroll
   boundary, insert start/middle/end at 1,000 items.
   PARTIALLY DONE (2026-07-10): `react/virtual-droppable.ts` defines the
   droppable-data contract (`VirtualInsertTarget.resolveBoundary`,
   pointer → visible boundary); provider collision detection recognizes
   it and emits insert-at-index; strip registers its scroll container as
   the droppable (fixed-slot math, reads scrollLeft live so intents track
   auto-scroll) and renders the boundary indicator in content coords.
   Story `DragIntoGapUsesVirtualBoundary` passes; main suite 15/15.
   COMPLETED (2026-07-10): `CrossStripMove` story (two strips, one
   provider); e2e VERIFIED that dnd-kit's built-in autoScroll drives the
   virtualized container while the live-scrollLeft boundary resolver
   tracks it (drop across scroll boundary at 1,000 items), plus
   left-edge insert-at-start e2e. Phase 3 DONE.
4. Variable widths: estimate/measure/cache/invalidate + scroll stability
   tests (width update after metadata load).
   MOSTLY DONE (2026-07-10): `itemWidthFor(node)` prop — metadata-driven
   widths evaluated lazily per index, cached by node id via the
   virtualizer's keyed measurements (no DOM render for layout);
   `resolveBoundary` + indicator now use `getVirtualItemForOffset` /
   measured starts (variable widths align exactly); cards fill their slot
   (`[&_[data-node-id]]:w-full`); `remeasure()` on the handle for
   metadata/zoom invalidation. `VariableWidthItems` story asserts widths,
   total-size math, and a gap drop between unequal cards; e2e 3/3 still
   green. COMPLETED (2026-07-10): `RemeasureAfterMetadataLoad` story —
   fallback estimate before load, `remeasure()` re-derives layout from
   real durations, scroll position stays put; drag ghost fills the
   DragOverlay wrapper so it matches variable display widths. Phase 4
   DONE. (Optional someday: DOM-measured `measureElement` intrinsic
   sizing — `itemWidthFor` covers metadata-derived widths.)
5. `VirtualGrid`: columns, responsive count, row/column keyboard, grid
   indicators.
   MOSTLY DONE (2026-07-10): `virtual/VirtualGrid.tsx` — row-based
   virtualizer over fixed cells; `columns` prop or responsive count via
   ResizeObserver; same `virtualInsert` droppable contract with 2D
   boundary math (row from y/floor, column boundary from x/round,
   scrollTop read live); grid drop indicator; scrollToNode/focusNode
   handle. Stories 3/3: 1,000-item mounted/spacer assertions, gap-drop
   boundary, play-less `GridPlayground` for e2e.
   COMPLETED (2026-07-10): grid keyboard row moves — the grid container
   declares `data-grid-columns`, and the provider remaps Alt+ArrowUp/Down
   to ±columns row moves (same column; boundaries announce) for cards
   inside it, leaving nest/move-out semantics everywhere else;
   `StripToGridMove` cross-view story; grid wheel-scroll e2e. Phase 5
   DONE except: responsive-resize story (ResizeObserver path is
   implemented but untested) and grid-scoped keys for nest/move-out
   (unbound inside grids for now — dropping on a collection card covers
   nesting).
6. `add-nodes` core extension + palette sources + trash target/restore.
   DONE (2026-07-10): patch model extended to a union — `nodes-added` /
   `nodes-removed` share the `NodeAdd` payload (full node + position), so
   invert = swap direction and removals stay restorable; `add-nodes`
   command (duplicate/empty/target validation);
   `resolveAddCommandFromIntent` delegates placement to the move resolver
   with an empty drag set; `PaletteItem` (factory runs at drag start —
   fresh ids per drag) + provider palette handling with ghost preview;
   `TrashTarget` = styled panel droppable over a hidden trash root (zero
   new machinery; undo restores). Unit 78/78 incl. add/undo/redo
   round-trip; stories `PaletteDropAddsNewNode` + `TrashMoveAndRestore`.
   Untested corner: palette drops into virtual strip/grid (works by
   construction — same intent path with empty drag set — but no story).
7. Hardening: §18 perf assertions (render-count probes at 1,000 items),
   §20 a11y audit, remaining §22 matrix.
   IN PROGRESS (2026-07-10): `RenderEfficiencyAtThousandItems` story —
   with 1,000 nodes, drag jitter across DIFFERENT boundaries (each an
   intent change re-rendering the strip's indicator) leaves a mounted
   bystander card's render count untouched; `TrashTarget` got a
   role="region" + descriptive aria-label.
   §22 matrix reconciliation (covered): 1,000-item strip/grid,
   variable-width strip, mixed media+collections strip, insert
   start/middle/end, drop into visible collection (incl. on-strip), drop
   into empty collection (empty trash receives via TrashMoveAndRestore),
   drop across scroll boundary + auto-scroll (e2e), keyboard to offscreen
   (focusNode story), media→collection, collection→collection, cycle
   rejects (self + descendant), trash media + restore, palette image
   into panel, width update after metadata + scroll stability, undo/redo
   everywhere.
   COMPLETED (2026-07-10) — all remainders closed, phase 7 DONE:
   selection-change announcements (effect on selection-set identity;
   asserted in MultiSelectDrag); Alt+Enter / Alt+Backspace as grid-safe
   nest/move-out synonyms (routing asserted in GridKeyboardRowMoves);
   `MultiSelectWithOffscreenItem` (unmounted m500 selected via store,
   dragged with +1 badge, lands in document order);
   `NestedCollectionMoveAndTrashSubtree` (nested collection moves with
   subtree; folder subtree trashed and restored);
   `PaletteIntoGridAndNestIntoCollection` (palette video into grid gap,
   palette collection nested into a collection card);
   `ResponsiveColumnCount` (600px→4 cols, shrink to 350px→2 via
   ResizeObserver). Final state: unit 78, stories 35 (4 files), e2e 11 —
   all green.

ALL SEVEN PHASES COMPLETE (2026-07-10).

Public API (§21) falls out of phases 2–6; expose config
(overscan/gaps/columns/sizing/autoscroll) as props on the virtual views,
custom rendering via the same slot pattern the repo already prefers.
