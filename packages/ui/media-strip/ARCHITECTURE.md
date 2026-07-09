# media-strip architecture

This is an onboarding doc, not an API reference — read it before making a
structural change to drag-and-drop, keyboard reordering, or the adapter
layer. For prop-level API details, read the exported types in `index.ts`
and the source directly.

## Package layout

```
core/                   Pure, framework- and DOM-independent domain logic.
                         No React, no adapter-specific types leak in here.
                         If a helper needs a react import, an HTMLElement,
                         or a DOM attribute name, it belongs in
                         media-strip.dom-utils.ts instead — that split is
                         what keeps this claim true.
media-strip.dom-utils.ts React/DOM-coupled helpers (the memo comparator,
                         DOM attribute-name constants, scroll-visibility
                         measurement) that core/ is not allowed to hold.
adapters/                One file per DnD backend (dnd-kit, pragmatic,
                         native-html5). Each implements the same
                         MediaStripDndAdapterComponents interface.
media-strip-dnd*.ts(x)   The adapter-agnostic runtime: context, provider
                         indirection, and the shared types every adapter
                         normalizes its events into.
media-strip-board*.ts(x) The multi-strip orchestrator: registry, drag
                         state, the drag controller, keyboard reorder
                         session, and the context those all publish.
media-strip-drag-store.ts External selector store for per-move drag state,
                         with the per-item subscription hooks (see the
                         "selector store" invariant below for why it's not
                         React context).
media-strip.tsx          A single strip: virtualization, selection,
                         rendering.
use-*.ts                 One hook per stateful concern, composed by
                         media-strip-board.tsx and media-strip.tsx rather
                         than inlined into either.
*.stories.tsx            Storybook stories. Their `play` functions are
                         this package's interaction test suite — see
                         "Testing strategy" below.
```

## Data flow: from a drag to a mutation

Every pointer drag — regardless of which adapter is active — funnels through
the same pipeline before anything mutates:

```
adapter-normalized drag event (active id, over id, raw pointer/rect data)
        │
        ▼
resolveDropTargetInfo (core/media-strip.dnd.ts)
        │  turns "what's under the pointer" into two things:
        │    - nestTargetId   (for the existing hotspot visual overlay)
        │    - DropPlacement  (the actual semantic decision)
        ▼
DropPlacement: "before" | "after" | "inside" | "container-end"
        │  (core/media-strip.types.ts)
        │  nesting always wins over reordering — the hotspot check
        │  collapses placement to "inside" before this point, so nothing
        │  downstream ever has to re-decide "is this a nest or a reorder?"
        ▼
resolveTimelineCommandFromDrag (core/media-strip.dnd.ts)
        │  the ONLY place a DropPlacement becomes a command. Handles
        │  same-collection index-shift math, cycle rejection, and
        │  same-position no-ops. Returns a DragCommandResolution:
        │  { ok: true, command, announcement } or
        │  { ok: false, reason, announcement } — every path, success or
        │  failure, carries an announcement so the caller never has to
        │  branch on `reason` just to talk to the aria-live region.
        ▼
TimelineItemCommand ("move" | "nest")
        │  (core/media-strip.types.ts)
        ▼
applyTimelineItemCommand (core/media-strip.collection-ops.ts)
        │  pure reducer, returns ApplyTimelineItemCommandResult:
        │  { ok: true, collectionsById } or { ok: false, reason }
        │  (missing-source | missing-target | cycle | same-position) —
        │  same ok/reason shape as DragCommandResolution, so a caller
        │  never has to identity-compare the map to detect a no-op.
        │  The consuming app owns this state; MediaStripBoard is a
        │  controlled component (collectionsById in, onMoveItem out).
        ▼
host app re-renders MediaStripBoard with the new collectionsById
        (on ok:false, keep the previous collectionsById — see
        handleMoveItem in any *.stories.tsx demo for the pattern)
```

Keyboard reordering (`use-keyboard-reorder-session.ts`) is a **separate**
path that also produces `TimelineItemCommand`s, but it's index-driven
(arrow keys move an item by one position) rather than placement-driven
(there's no pointer to resolve a `DropPlacement` from), so it doesn't go
through `resolveTimelineCommandFromDrag`. It does reuse the same
`wouldCreateCollectionCycle` check and the same command shapes, so a
keyboard-driven nest and a pointer-driven nest still end up producing
identical `TimelineItemCommand`s. It has its own pure resolver for the same
reason `resolveTimelineCommandFromDrag` exists —
`resolveKeyboardReorderAction` (`core/media-strip.keyboard.ts`) takes an
item id, a `KeyboardReorderAction` (everything except `"confirm"`/
`"cancel"`, which are genuine session-lifecycle transitions the hook still
owns directly), and read-only board state, and returns a `{kind: "move" |
"no-op" | "rejected", ...}` resolution with no side effects. See its unit
tests in `core/media-strip.keyboard.test.ts` for the exact no-op-vs-
announced-boundary matrix (e.g. `move-home` when already first is a
*silent* no-op, but `move-left` when already first announces "Already
first in collection." — that asymmetry is existing behavior, preserved
intentionally, not a bug).

## The adapter contract

**Adapters may differ in DOM mechanics, but they must resolve to the same
command semantics.** Concretely:

- dnd-kit uses `PointerEvent`s and its own collision-detection engine.
- pragmatic (`@atlaskit/pragmatic-drag-and-drop`) and native-html5 both use
  the browser's native HTML5 Drag and Drop API (`dragstart`/`dragover`/`drop`),
  not pointer events.
- All three normalize into the same `MediaStripDndNormalizedDragMoveEvent`
  shape (`core/media-strip.dnd-adapter.ts`) before `resolveTimelineCommandFromDrag`
  ever sees them. Nothing downstream of that normalization is allowed to
  know which adapter is active.
- `nestTargetId`/`placement` on those events are required-but-nullable,
  never optional: pragmatic and native-html5 resolve them per move (via
  `getDropTargetInfo`); dnd-kit passes explicit `null`s because its
  resolution arrives out-of-band through the collision-detection callback.
  The board's drag controller branches on
  `capabilities.supportsCollisionDetection` to know which source to trust —
  not on whether the fields happen to be present.
- The runtime context (`media-strip-dnd-runtime.tsx`) carries the adapter
  and nothing per-drag. Fast-changing drag state (e.g. the manual adapters'
  overlay position) lives in adapter-local external stores
  (`adapters/external-store.ts`) subscribed to by exactly the leaf that
  renders it — routing it through the context re-renders the whole strip
  subtree per pointer move (the bug the pragmatic adapter used to have).
- `MediaStripDndCapabilities` (`media-strip-dnd.types.ts`) declares what
  each adapter actually does under the hood (sortable transforms, built-in
  collision detection, manual vs. automatic autoscroll/overlay
  positioning) — this is documentation-as-types, not a runtime branch.
  Nothing in the resolution pipeline should ever need to check
  `adapter.id` to decide *what a drop means*; capabilities exist so a
  consumer or a test can reason about *how* a given adapter gets there.

If you add a fourth adapter, the bar is: it must produce the same
`DropPlacement`/`TimelineItemCommand` for the same on-screen drag, even if
its internal event wiring looks nothing like the other three.

**Importing an adapter.** The three adapter instances are intentionally
NOT re-exported from `index.ts` — each pulls in a different optional peer
dependency (`@dnd-kit/*`, `@atlaskit/pragmatic-drag-and-drop`), and
barrel-exporting all three from the root module would force every consumer
to have all three resolvable just to import `MediaStrip` or a type. Import
the one you use directly from its own module, e.g.
`@storyboard/ui/media-strip/adapters/dnd-kit-adapter`. Do not "fix" this by
adding them back to `index.ts` — that reintroduces the forced coupling.

## Ingestion boundary: parse vs. validate

`core/media-strip.validation.ts` (`validateTimelineItem`, `createImageTimelineItem`,
etc.) and `core/media-strip.parse.ts` (`parseTimelineItem`, `parseTimelineCollection`,
`parseTimelineCollectionsById`) look similar but answer different questions —
picking the wrong one at a boundary is a real crash risk, not just a style choice:

- **`validate*`/`create*` validate an already-shaped item.** They assume the
  input is already a `TimelineItem`-shaped object with a valid `kind`
  discriminant, and check *values* (empty strings, negative durations,
  mismatched trim math). `validateTimelineItem` dispatches via
  `validators[item.kind]` — if `kind` is missing, misspelled, or not one of
  the three valid strings, that dispatch throws a raw `TypeError` instead of
  returning a validation failure. These are the right tools once you already
  trust the shape: constructing a new item from known-good app state,
  patching an existing item, revalidating a candidate you built yourself.
- **`parse*` is the actual ingestion boundary for genuinely `unknown` data**
  — an API response, a parsed JSON file, anything not already known to be
  shaped like a `TimelineItem`. Each `parse*` function never throws
  regardless of input shape: a two-phase check (cheap structural/type checks
  first — is this even an object, does `kind` exist and match, are fields the
  right primitive type — then delegation to the existing `create*`/
  `validateTimelineCollection` for value-level checks) means every failure
  mode comes back as a typed `TimelineItemParseError` /
  `TimelineCollectionParseError` / `TimelineCollectionsByIdParseError`
  instead of an exception. `parseTimelineCollectionsById` expects the object
  wire-format a `Map` naturally serializes to (`{ [id]: collection, ... }`)
  — a deliberate choice for this parser, not dictated elsewhere in the
  codebase.

Use `parse*` wherever data crosses from "outside this app's control" into
`TimelineItem`/`TimelineCollection` shape. Use `validate*`/`create*`
everywhere downstream of that boundary, where the shape is already trusted.

## Key invariants

- **Branded IDs** (`TimelineItemId`, `CollectionId` in `core/media-strip.types.ts`)
  are both plain strings at runtime — the branding is compile-time only,
  enforced by nominal types plus `parse*`/`trusted*` constructors. Never
  cast one to the other. `trustedTimelineItemId`/`trustedCollectionId`
  parse-or-throw for authoring-time-trusted input (literals,
  framework-generated ids) — named `trusted*`, not `as*`, because they run
  a real runtime check and throw on failure, unlike a TypeScript `as` cast.
- **Nesting wins over reordering.** `resolveDropTargetInfo` collapses
  `DropPlacement` to `{ kind: "inside" }` the moment the pointer enters a
  collection card's center [20%, 80%] hotspot (`isPointInNestHotspot`).
  Nothing else in the pipeline re-adjudicates that priority.
- **`detectCollision` must check "is the pointer within this droppable"
  before falling back to nearest-neighbor search.** `getClosestCenterCollisions`
  has no distance cutoff — given a non-empty candidate list it always
  returns *something*, sorted by distance, never an empty array. That means
  a strategy of "search items first, fall back to container backgrounds
  only if the item search found nothing" is a bug: the item search is
  non-empty (and so the fallback never triggers) as long as *any* other
  item exists *anywhere on the board*, even when the pointer is sitting
  inside a completely unrelated empty container. `detectCollision` guards
  against this with `isPointWithinRect` (`core/media-strip.utils.ts`):
  it only trusts a closest-center result once it's already restricted to
  droppables the pointer is geometrically inside; a pure "closest anywhere"
  search is the last resort, not the first. See
  `PointerDragIntoEmptyStripWithOtherItemsOnBoard` in
  `MediaStrip.reorder.stories.tsx` for the regression this guards against —
  it fails immediately if this ordering is undone.
- **Same-collection index math is post-removal.** `TimelineItemCommand.toIndex`
  is always "the index after the source item has already been spliced
  out." When a `DropPlacement` references a target in the *same*
  collection as the dragged item, and the target's current index is
  greater than the source's, `resolveTimelineCommandFromDrag` shifts the
  target index down by one before computing before/after. Getting this
  wrong is exactly the bug class that motivated centralizing this logic —
  see the regression tests in `core/media-strip.dnd.test.ts`
  (`resolveTimelineCommandFromDrag` describe block) before touching this.
- **`MediaStripBoard` is a controlled component.** It never mutates
  `collectionsById` itself — every command goes out through `onMoveItem`
  and the new state comes back in as props. There is currently no
  undo/redo or history inside this package; if the host app wants that,
  it owns it, since it's the one holding the actual collection state.
- **Per-move drag state goes through a selector store, not React context.**
  Drop placement, nest target/validity, and the rejection flash change on
  every pointer move. If items read those from context, *every* mounted item
  re-renders on *every* move (context has no per-consumer selectivity), even
  though only one item's drop indicator or nest overlay actually changes.
  So that state lives in an external store (`media-strip-drag-store.ts`);
  each item subscribes via `useSyncExternalStore` to a selector that returns
  a primitive (`useMediaStripItemDropSide`, `useMediaStripItemNestState`,
  `useMediaStripItemRejected`), and React's `Object.is` check skips the
  re-render whenever that item's slice is unchanged. The board still holds
  this state as React state (it drives the drag overlay + aria-live
  announcer) and pushes each snapshot into the store in a `useLayoutEffect`
  — synchronously after the board's commit, before paint, so subscribers
  update in the same frame. `MediaStripBoardStableContext` still carries the
  genuinely stable board-level values (the collection map, registry
  callbacks, keyboard-session actions).
- **`resolveDropTargetInfo` must reject the active item as its own drop
  target before computing a placement, not just before nesting into it.**
  dnd-kit's `detectCollision` filters the active item out of its candidate
  list, so this never comes up for that adapter — but native-html5 and
  pragmatic report whatever element the browser says is under the pointer,
  which can legitimately be the dragged item's own element (native
  `dragover` still fires on the source while it's mid-drag). Hovering the
  right half of your own item resolves to `{ kind: "after", itemId: self }`,
  and `resolveTimelineCommandFromDrag`'s same-position no-op check only
  catches "before" on yourself (same index), not "after" (index + 1) — so
  without the guard, "dropping on yourself" produced a real one-slot move.
  See the self-target tests in `core/media-strip.dnd.test.ts`
  (`resolveDropTargetInfo` describe block) and
  `ConformanceNativeHtml5SelfDropIsNoOp` in
  `MediaStrip.native-html5-conformance.stories.tsx`.
- **`MediaStripBoard` warns (dev-only) when `collectionsById` fails
  `validateProjectTimeline`, except for `"missing-collection."`** Duplicate
  global item ids and multi-parent collections silently corrupt
  `itemLookup`/`parentByCollectionId` (both are keyed maps that just
  overwrite on collision) without ever throwing, so they're worth
  surfacing loudly rather than waiting for a "why did my drag do that" bug
  report. `"missing-collection"` is deliberately excluded: a
  `CollectionTimelineItem` whose backing collection isn't loaded yet is the
  expected shape for a lazily-loaded app (a collection card renders from
  its own `itemCount` before its contents are fetched — see
  `syncCollectionItemCounts`'s fallback-preserving behavior), and it
  doesn't corrupt either map the way the other three reasons do. See
  `InvalidGraphWarnsInDev` and `LazilyUnloadedCollectionDoesNotWarn` in
  `MediaStrip.edge-cases.stories.tsx`.
- **The non-empty-strip droppable must be at least viewport-width, not just
  content-width.** In `media-strip.tsx`, the `ToggleGroup` that wraps a
  strip's items is also its container-background droppable
  (`setViewportAndDroppableRef` attaches both refs to the same node) — a
  short strip in a wide container used to leave the space to the right of
  its last item outside any droppable, unlike the empty-state branch (a
  plain div with no explicit width, which naturally fills its parent).
  Fixed with `min-w-full` alongside the existing content-width inline
  style. This is asserted as a direct geometry check
  (`ShortStripDroppableFillsWideContainer` in
  `MediaStrip.reorder.stories.tsx`), not an end-to-end drag: dnd-kit's
  "closest item anywhere" fallback (see the `detectCollision` invariant
  above) means a drag dropped near a short strip's only item can still
  resolve correctly via that fallback regardless of this bug, which makes
  an end-to-end drop assertion an unreliable way to pin down this
  specific claim.
- **`MediaStripSelection` carries `collectionId`, because `onSelectionChange`
  only ever reports the strip that fired it.** A consumer sharing one
  `selectedIds` array across multiple sibling `<MediaStrip>`s (a supported,
  demonstrated pattern — see `ReorderDemo` in `MediaStrip.reorder.stories.tsx`)
  cannot correctly do `onSelectionChange={(s) => setSelectedIds(s.selectedIds)}`:
  that replaces the whole shared array with just the changed strip's
  selection, silently clobbering the other strips'. `collectionId` lets a
  board-aware consumer merge instead — drop only the ids that belonged to
  the strip that changed, keep the rest. `ReorderDemo`'s
  `handleSelectionChange` does this and is the canonical example to copy;
  `SelectionSurvivesAcrossStrips` is the regression test proving it works
  (and fails without the merge — verified by hand before landing this).

## Testing strategy

- **Unit tests** (`*.test.ts`, run via `vitest --project=unit`, plain Node,
  no DOM): every pure function in `core/` and `adapters/dom-autoscroll.ts`.
  This is where placement/command resolution correctness lives — fast,
  no browser needed. `core/media-strip.parse.test.ts` specifically asserts
  the parse/validate boundary claim above: that a malformed `kind` crashes
  `validateTimelineItem` but not `parseTimelineItem`.
- **Story interaction tests** (`*.stories.tsx` `play` functions, run via
  `vitest --project=storybook`, real Chromium through Playwright): these
  are this package's end-to-end tests, not just visual documentation.
  `media-strip.stories-helpers.ts` has two families of drag simulators:
  - `simulatePointerDrag*` — dispatches `PointerEvent`s. Only works
    against the **dnd-kit** adapter (its `PointerSensor` is what's
    listening).
  - `simulateNativeDrag`/`dispatchNativeDragSequence` — dispatches native
    `DragEvent`s with a real `DataTransfer`. Verified working against the
    **native-html5** adapter.
  - **The pragmatic adapter is exported as `experimental` for this exact
    reason: its actual drag interaction is not covered by an automated test
    today.** `@atlaskit/pragmatic-drag-and-drop` ships its own internal
    "honey pot" workaround that re-derives the element under the pointer via
    `document.elementFromPoint` rather than relying solely on which element a
    bubbled event lands on, so `simulateNativeDrag` doesn't reliably drive it
    (confirmed empirically — a same-strip drag silently no-ops). Its stories
    still render and get visually documented, but a regression in its actual
    drag behavior would not be caught by the test suite. The status is
    encoded in the export name (`experimentalPragmaticMediaStripDndAdapter`),
    not just here, so a consumer can't reach for it without seeing it.
    Promoting it out of `experimental` means either reverse-engineering
    pragmatic's internal event handling to drive it in a test, or
    substituting a different verification path — neither attempted yet.

## Known gaps (check before assuming these are solved)

- ~~No first-class "move this item back out to its parent collection"
  affordance for pointer or keyboard.~~ Fixed for keyboard: pressing `U`
  during a keyboard reorder session (`"move-to-parent"` in
  `KeyboardReorderAction`, `core/media-strip.keyboard.ts`) moves the item out
  to `parentByCollectionId`'s entry for its current collection, landing right
  after the collection-item card that represents where it came from
  (`use-keyboard-reorder-session.ts`). At the root collection (no parent)
  it's a no-op with an announcement. **Pointer drag still has no equivalent
  gesture** — the collection graph is still only navigable outward by a
  collection's contents being rendered as their own sibling `<MediaStrip>`,
  not via a pointer-driven "up" affordance.
- ~~Rejected drops (cycle, etc.) only get an aria-live announcement — no
  visual feedback for sighted pointer users yet.~~ Fixed: a rejected item
  briefly gets `data-rejected="true"` (destructive ring + pulse), driven by
  `use-media-strip-rejection-flash.ts` and read per-item via the drag store's
  `useMediaStripItemRejected` selector, for both the pointer and keyboard
  nest paths.
- **Virtualization + pointer drag has been audited and the core case
  works.** dnd-kit re-measures its droppable registry as items mount, so
  dragging between two items that were unmounted moments ago (only
  entering the DOM after a scroll) resolves correctly — see
  `PointerDragBetweenTwoUnmountedVirtualizedItems` in
  `MediaStrip.scale.stories.tsx`. Dropping on empty container space when
  the specific target item isn't mounted falls back to `container-end`
  (append), which is a reasonable UX default, not a silent bug — you can't
  precisely target something you can't see anyway. **Not directly
  verified**: dnd-kit's own built-in autoscroll *during* an active drag —
  see the note in the "Testing strategy" section above about why that
  specific interaction couldn't be reliably simulated. If a future bug
  report describes "drag stalls near a virtualized strip's edge," start
  there.
