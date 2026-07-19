# Storyboard app architecture: one graph, one provider, many views

**Status:** proposed — converged through design review, ready for team review.
**Scope:** the app-level domain model for the storyboard application and how it
relates to `packages/ui/dnd-collections`, `packages/ui/timeline`, and
`apps/timeline-gstudio001`.

## Decision (summary)

The **dnd-collections graph is the app-level structural source of truth.**
The storyboard's "collection of timelines" is an exact match for the graph's
model:

| App concept | Graph concept |
| --- | --- |
| The multiple top-level timelines on a page | `rootIds` — ordered root collections |
| A timeline | a `collection` node |
| A media clip in a timeline | a `media` node (image/video, with trim) |
| A collection inside a timeline | a `collection` node (child of that timeline) |
| That collection expanded as a sub-timeline beneath its parent | rendering the child collection as its own strip |
| Sub-timelines containing collections, recursively | arbitrary-depth `childrenById` — native |

One graph, one page-level `<DndCollections>` provider, and every way the user
explores the structure — timeline strips, inline sub-timelines, drill-in
focus, breadcrumbs, grids, trees — is a **view projecting that one graph**.

Around the graph sits a thin domain layer: a side-table for app-level detail
the engine doesn't model, a reusable asset library, and a
persistence/hydration adapter. Nothing in `dnd-collections` is moved,
renamed, or restructured; it is consumed as the engine it was built to be.

## Context: what exists today

- `apps/timeline-gstudio001` + `packages/ui/timeline` (~14k lines): the
  current timeline app. Model: `Record<id, TimelineDocument>`, each document a
  flat `TimelineClip[]`; collection clips point at child documents via
  `childTimelineId`; per-document Firebase persistence; its own DnD
  (`packages/ui/drag-drop`).
- `packages/ui/dnd-collections`: the normalized-graph collections engine —
  pure core (graph/commands/reversible patches/history), a selector store
  with a proven no-bystander-re-render guarantee, virtualized views
  (`VirtualStrip`/`VirtualGrid`/`CollectionPanels`), consumer content slots,
  trim system, and ~460 unit + ~106 story + 24 e2e tests.

The `childTimelineId` document map is a **storage representation**, not the
semantic model. Semantically the product is a containment forest — timelines
holding media and collections, collections being sub-timelines, recursively —
which is precisely the graph. This document reconciles the two: the graph is
the in-memory domain truth; document-per-collection remains the persistence
and lazy-loading unit underneath it.

## 1. One page, one provider

Per current app needs there is **exactly one `<DndCollections>` per page**.
The provider owns the store (graph + selection + live drag + undo/redo), the
DnD sensors and collision pipeline, the announcement live region, the FLIP
sweep, and the consumer component registry. Every view on the page is a child
of that one provider:

```tsx
<DndCollections initialGraph={hydratedForest} components={APP_COMPONENTS} onChange={persist}>
  <BreadcrumbBar />                     {/* ancestor path of the focused node */}
  <VirtualStrip collectionId={focused} />        {/* the focused timeline */}
  {expanded.map((id) => <VirtualStrip key={id} collectionId={id} />)}  {/* inline sub-timelines */}
  <VirtualGrid collectionId={libraryId} />       {/* another lens on the same graph */}
</DndCollections>
```

What this buys, with zero sync code:

- **One graph value** — no copies, no divergence. (Mounting a provider per
  view would fork the graph; that is the documented anti-pattern.)
- **Global selection, drag, and undo** that are coherent across every view.
- **Cross-view drag for free**: all droppables register under one collision
  pipeline, so dragging from a grid into a timeline strip is native.
- **One FLIP sweep** animating a committed move consistently in every view
  that shows it.

## 2. Views are projections; navigation is view-state

A view never owns structure. It picks a node and renders that node's children
its own way (`VirtualStrip collectionId`, `CollectionPanels collectionIds`,
custom views via the store selectors and compound primitives).

- **Inline sub-timeline:** render a child collection as a strip beneath its
  parent. Pure view choice.
- **Drill-in focus (clickable collection):** clicking a collection makes it
  the top-level of the display. This changes *which node the page renders
  from* — never the graph. The focused id lives in **route state** (the
  existing `[[...activeTimelinePath]]` segment already encodes exactly this),
  giving deep-linking and back-navigation for free.
- **Breadcrumbs:** the ancestor walk from the focused node via `parentById` —
  O(depth) on the built-in reverse index, replacing today's scan of every
  document.

State split (the load-bearing rule):

| Shared — in the one store | Per-view / route — local |
| --- | --- |
| graph, selection, live drag, undo/redo | focused node, scroll, expansion, view mode |

## 3. App-level detail: the side-table rule

App items carry far more than the engine needs. That detail lives in a
**side-table keyed by node id**, partitioned by one rule: *does the engine
read or mutate the field?*

- **On the graph node** (engine-owned, edited through engine commands):
  structure/order, `durationSeconds` / `fullDurationSeconds` / `trimIn` /
  `trimOut`, and the display projection the cards need (`name`, `src`,
  `posterSrcs`).
- **In `detailById: Record<NodeId, Detail>`** (domain-owned, edited through
  domain commands): aspect, alt, `assetId`, collection preview/count,
  playback rate, upload/Firebase metadata — and any future field. Extending
  the app schema never touches the engine.
- **`assetsById`**: the reusable media library. Assets are shared and
  referenced (`assetId`), never positioned, so they are not graph nodes. A
  node's `name`/`src` is a *derived projection* of its asset with a single
  source; an asset rename re-projects onto affected nodes (the existing
  `syncParentCollections` pattern, formalized).

No field is canonical in two places. Every mutation is one domain command
producing **one reversible patch** that composes the engine's structural
patch with the entity change — node and detail are created, moved, and
removed atomically, and an invariant checker (`record-without-node`,
`unclassified-node`, asset-reference integrity) guards drift in tests and on
ingest.

## 4. Persistence and lazy hydration

Storage keeps today's shape — **one stored document per collection** (its
direct children + metadata), persisted individually (Firebase) — as the
adapter under the graph:

- Collection node ⇄ stored document; `childTimelineId` is simply how a
  collection's children are stored separately.
- **Hydrate on focus/expand:** a collapsed, un-navigated collection is a
  placeholder node (empty children; count/preview from its detail record).
  Navigating into it — the clickable-collection feature — fetches its
  document and splices the children into the graph. Focus *is* the
  lazy-loading trigger, so the working set is naturally bounded to the
  focused subtree + ancestors + shallow previews, unioned across mounted
  views.
- **Hydration is out-of-band:** it never enters the undo stack. User undo
  replays user commands only. A drop into an un-hydrated collection hydrates
  first (or is gated until expanded).
  *Implemented:* the engine now ships this as `store.hydrate(collectionId,
  specs)` / core `hydrateCollection` — fills an empty placeholder, pushes no
  history entry, emits nothing on the change feed, and (because it only adds
  nodes under a childless collection) leaves every history patch replayable,
  so one provider and one undo stack live across all focus navigation. The
  domain payload comes from `@storyboard/timeline-domain`'s
  `buildHydrationSpecs`.
- Writes flow from the store's `onChange`/`subscribeToChanges` feed: a commit
  names exactly the affected collections (patch-scoped), so persistence
  writes only the documents that changed.

## 5. Commands, undo, integrity

All structural mutation goes through the engine's `applyCommand` — move,
add, trim — giving cycle rejection (a timeline can never be dropped into its
own descendant), post-removal index math, and reversible patches. Domain
commands (rename, reassign asset, set playback rate) mutate the side-table
with entity-change patches. Undo/redo is global, patch-based, and already
battle-tested in the engine.

## 6. Performance contract

This is the axis the engine was built for, and it extends to the app views:

- **Structural sharing:** a move re-allocates only the touched children
  arrays; `nodesById` is untouched by moves.
- **Selector store:** a drag over one card re-renders that card alone — the
  no-bystander guarantee is asserted by render-count tests
  (`RenderEfficiencyDuringDrag`, `CustomContentRenderEfficiency`) and holds
  *across* views because they share one store. App views must keep the
  selector discipline (stable references, per-node subscriptions).
- **Virtualization** per strip/grid; 1,000-node collections stay a bounded
  DOM.
- **O(depth) breadcrumbs** and O(1) parent lookups via `parentById` — no
  document scans.
- **Derived, never stored:** clip start times come from order + durations
  (`createTimeToOffset`: prefix sums at commit cadence, O(1)-amortized cursor
  per frame for playheads).
- **Patch-scoped persistence** (write only changed documents) and
  hydration-bounded memory.

## 7. Migration (each phase shippable, reversible)

1. **Domain package** (`@storyboard/timeline-domain` or similar, framework-
   free): the side-table + asset types, domain commands, invariant checks,
   and the storage adapter (stored document ⇄ collection node + details).
   Engine imported via the pure `@storyboard/ui/dnd-collections/core` entry
   point through a single seam file. *(The patch-composition machinery from
   the superseded branch is reusable here; its invented scene/track/asset
   model is not.)*
2. **One page end-to-end in the app:** one `<DndCollections>` provider, the
   focused-timeline strip + breadcrumbs rendered from the graph, hydrate-on-
   focus, persistence via the change feed. Prove parity with the existing
   page (reorder, trim, nest, undo) behind a route flag.
3. **Add exploration views** (grid/tree/panels) as children of the same
   provider; retire the corresponding bespoke views in `packages/ui/timeline`
   as they're replaced. The `TimelineDocument` type narrows to the storage
   format.

`packages/ui/dnd-collections` is not modified at any phase (beyond the
already-additive pure `core/` entry point). `packages/ui/timeline` shrinks by
replacement, never by big-bang rewrite.

## 8. Supersedes / relationship to prior work

- `codex/storyboard-domain-foundation` (preserved at `f1c3f43`): right
  instinct that the domain should sit on the graph; superseded because it
  relocated/split dnd-collections (~80 deletions) and invented a
  scene/track/asset vocabulary. Not merged.
- `feat/storyboard-domain-foundation` (`348ab7d`): cleaner packaging of the
  same invented model; **superseded by this design — do not merge.** Its
  reusable pieces: the pure `core/` entry point, the engine-seam pattern, the
  reversible patch-composition machinery, the invariant-checker shape.
- All dnd-collections work (consumer content slots, compound primitives,
  trim system, `timeToOffset`, virtualized views) becomes **load-bearing** in
  the app under this design.

## 9. Open questions (to settle before phase 2)

1. **Single-parent confirmation:** a collection lives under exactly one
   parent (containment). If the product ever needs the *same* collection
   instanced under multiple parents, that is a different model — flag now.
2. **Hydration ↔ undo policy details:** settled in full. Undo history
   survives focus navigation via `store.hydrate` (see § 4). Drops into
   un-hydrated collections are handled by two cooperating layers: every
   VISIBLE placeholder collection hydrates eagerly (the focused timeline's
   children plus the grandchild cards inside their strips — the working set
   stays view-bounded), and the residual race is REFUSED BEFORE IT COMMITS
   by the store's `commandPolicy`
   (`collectUnhydratedDropTargets(command, details)` → `blocked-by-policy`
   + rejection flash + announcement) so content can never land in, or
   overwrite, a document whose clips haven't loaded. Writes additionally
   refuse any collection with `hydrated: false`.

   The veto is deliberately PRE-commit. An earlier design let the drop
   commit and had the persistence bridge undo it back out; that reverts the
   graph but not the history, because pushing a command clears the redo
   branch. A bounced drop therefore discarded whatever the user still had
   to redo and left the refused command itself sitting on the redo stack.
   Any future application-level gate belongs in the same policy seam, not
   in a post-commit subscriber.
3. **Eviction:** whether far-from-focus subtrees are ever de-hydrated, or
   memory is allowed to grow monotonically per session (likely fine at
   storyboard scale; decide explicitly).
4. **Scale ceiling:** one in-memory graph is proven to ~10³ nodes in tests;
   if projects are expected to exceed ~10⁴–10⁵ nodes, hydration policy does
   the bounding — validate with a soak fixture.
