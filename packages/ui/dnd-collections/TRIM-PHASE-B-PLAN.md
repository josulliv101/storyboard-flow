# Trim UX — Phase B plan (left-grows-left + live overview)

> Status: **SHIPPED.** Phase A shipped first (amber `TrimOverview` source-window
> strip, `showing / full` pill, amber handles, overview locked to the strip's
> `trimPixelsPerSecond` so the window == clip width). Then the "X-alignment"
> decision + its live-overview-sync mechanism shipped. Then the "left grows
> left" mechanic (this doc's core goal) shipped: a left-handle drag anchors
> the clip's RIGHT edge so the left edge follows the cursor and left neighbors
> slide left. It anchors via a composited **transform** on the content layer
> derived from live-trim state (`previewTrim`, `trimBaselineRef`,
> `dragShiftX`), reconciled to a real `scrollLeft` at commit — NOT a per-frame
> `scrollLeft` write (an earlier version did that and stuttered, and clamped
> at the strip start so a shrink there wrongly shrank the right edge). See
> `virtual/VirtualStrip.tsx` and ARCHITECTURE.md's trim section. What remains
> is only the OPTIONAL Phase B.2 (draggable overview handles) below. Reference
> implementation matched: `packages/ui/timeline/media/video-source-filmstrip.tsx`.
>
> **Known limitation (accepted):** the transform anchors consistently during
> the drag at any scroll position, but the COMMIT converts it to native
> `scrollLeft`, which is bounded at 0. On the FIRST item (index 0, no left
> neighbors) the left drag keeps grow-right; and committing a left-trim on a
> clip at the strip start can snap by the shortfall the scroll can't absorb.
> This suits `VirtualStrip`'s large-collection purpose; a non-scrollable
> timeline genuinely can't represent "grow past content 0" in native layout.

## Goal (from the user's recording)

1. **Left handle grows LEFT.** Dragging the left (trim-in) handle leftward
   extends the clip toward the left: its **right edge stays anchored**, the
   left edge follows the cursor, earlier frames reveal, and **left neighbors
   are pushed left**; right neighbors don't move. (Right handle is unchanged:
   grows right, left edge anchored.)
2. **Live overview.** The amber "showing" window in `TrimOverview` (and the
   clip) resize **together during the drag**, not just on release. Same
   `pixelsPerSecond`, so window width == clip width at every frame.
3. **Better performance than the app** — reuse the existing render-efficient
   trim engine (targeted `resizeItem`, no card re-renders, no mid-drag graph
   commit). Add only O(1) work per pointer-move.

## Current state (what exists today)

- `react/trim-handles.tsx` — pointer-drag on the card edge. Per move:
  `resolveTrim(startNode, side, deltaSeconds)` → `{ update, effectiveSeconds,
  trimInSeconds, trimOutSeconds }`; calls `trimPreview.previewTrim(node.id, {
  trimInSeconds, trimOutSeconds, effectiveSeconds })`; commits ONE
  `update-media` on release; resets preview (`previewTrim(node.id, null)`) on
  abort/no-op.
- `react/trim-preview-context.ts` — `TrimPreview.previewTrim(nodeId, live |
  null)`, `live = { trimInSeconds, trimOutSeconds, effectiveSeconds }`.
  Default NOOP (panels don't live-resize and never mount an overview).
- `virtual/VirtualStrip.tsx` — implements `previewTrim` via
  `virtualizer.resizeItem(index, size)` where `size = effectiveSeconds * pps +
  gap` (unchanged growth-rightward behavior; the scroll-anchor below is not
  yet built), AND stashes the live `{ nodeId, trimInSeconds, trimOutSeconds }`
  in a ref (`liveTrimRef`, cleared whenever `nodesById` changes identity) that
  the overview reads during render. `scrollRef`/`virtualizer` are in scope
  here — the scroll-anchor would live here too.
- `react/trim-overview.tsx` (`TrimOverviewStrip`) — a presentational component
  that no longer self-selects from the store; `VirtualStrip` looks up the
  selected video, resolves its mounted item, and passes `node`, `anchorLeft`,
  and the live-or-committed `trimInSeconds`/`trimOutSeconds` as props. Already
  reads LIVE values during a drag (not just committed) and is already
  positioned directly over its clip (see the resolved "X-alignment" decision
  below) — both were originally scoped as Phase B work but shipped ahead of
  it, since alignment required them anyway.

## The mechanism — "left grows left" via resizeItem + scrollLeft

`resizeItem` keeps `offset[index]` fixed and shifts indices `> index` right by
the size delta. So growth appears on the RIGHT. To visually anchor the RIGHT
edge (so growth appears on the LEFT), pair the resize with a scroll shift on
the same container:

```
At left-drag start, capture baseline:
    size0       = current cached item size (px, incl. gap)
    scrollLeft0 = scrollRef.current.scrollLeft

Per pointer-move (left handle only):
    newSize = effectiveSeconds * pps + gap
    resizeItem(index, newSize)                 // content: right edge -> offset+newSize
    scrollRef.current.scrollLeft = scrollLeft0 + (newSize - size0)
```

Why this is exactly right (viewport x = contentX − scrollLeft):

- **Item right edge**: `(offset + newSize) − (scrollLeft0 + newSize − size0)` =
  `offset + size0 − scrollLeft0` → **constant** (anchored). ✓
- **Item left edge**: `offset − scrollLeft` → moves **left by Δ** as newSize
  grows (Δ = newSize − size0). ✓
- **Right neighbors**: content offset shifted right by Δ by `resizeItem`, minus
  scroll +Δ → net **0** (stay put). ✓
- **Left neighbors**: content offset unchanged, minus scroll +Δ → shift **left
  by Δ** (pushed left). ✓

Right-handle drags: **no scroll change** — today's behavior already grows right
with the left edge anchored. Only the left handle runs the scroll-anchor.

Cost per move: one `resizeItem` (already reconciles only the ~20 mounted slot
divs, no card re-renders) + one `scrollLeft` write. O(1). This is the "better
performance" — the app re-lays/re-renders; we don't.

## Drag lifecycle (precise sequencing)

- **left pointerdown**: capture `size0`, `scrollLeft0` (baseline ref in
  VirtualStrip, keyed by nodeId).
- **pointermove**: compute `effectiveSeconds`; `resizeItem`; set `scrollLeft`
  per formula; publish live trim state for the overview (see below).
- **pointerup (commit)**: handle dispatches `update-media` (graph trimIn/out
  changes → the `measure()` effect on `nodesById` identity re-measures). The
  committed size == last preview size and `offset[index]` is unchanged, so the
  viewport position is already correct — **do NOT restore scrollLeft**. Clear
  baseline + live-trim slice.
- **pointercancel / no-op**: `resizeItem(index, dataSize)` AND restore
  `scrollLeft = scrollLeft0`; clear baseline + slice. (Abort must restore
  scroll; commit must not.)

## Live overview sync

The overview needs `trimIn/out` (not just effective) to place the window, and
must update per move. Add a **live trim-preview slice to interaction state**
(this is consistent with the existing invariant: "the live preview is
interaction state in the store" — the GRAPH is never mutated mid-drag):

```
interaction.trimPreview: { nodeId, trimInSeconds, trimOutSeconds } | null
```

- Set it per move, clear on release/abort. Keep the field reference stable
  (null when inactive) per the snapshot-identity contract.
- `TrimOverview` reads it via selector; when it matches the selected node, it
  positions the amber window from the live values, else from committed values.
- Only `TrimOverview` subscribes to this slice → only it re-renders. **Cards do
  NOT read it**, so no bystander re-renders (the card still resizes via
  `resizeItem`, the view-only path). Two channels, one source: the handle
  drives both per move.

Where to publish: do it inside VirtualStrip's preview implementation (so panels
NOOP cleanly and the handle stays view-agnostic).

## Files to touch

1. `react/trim-preview-context.ts` — widen the callback, e.g.
   `previewTrim(nodeId, { effectiveSeconds, side, trimInSeconds, trimOutSeconds }
   | null)`. Keep the value reference-stable.
2. `virtual/VirtualStrip.tsx` — implement `previewTrim`: baseline ref, resize,
   left-only scroll-anchor, commit-vs-abort reset, publish the interaction
   slice. (`scrollRef`, `virtualizer`, `gap`, `pps` already in scope.)
3. `react/collections-store.ts` — add `interaction.trimPreview` + setter;
   include in snapshot with stable identity.
4. `react/trim-handles.tsx` — call `previewTrim` with `side` + computed
   `trimIn/out` (derivable from `update` + `startNode`); commit clears without
   scroll restore; abort resets.
5. `react/trim-overview.tsx` — overlay the live slice onto committed values.
6. Stories — `TrimOverviewShowcase` (vid trimIn=2, trimOut=1.5) is the
   play-less fixture for the e2e; add a play story asserting live sync if
   useful.
7. `apps/web/tests/e2e/dnd-collections.spec.ts` — real-mouse Phase B test
   (below).
8. Docs — ARCHITECTURE.md trim section + API.md (`TrimOverview`, widened
   `TrimPreview`).

## Tests

- **Story (simulated pointer)** on a virtual strip: left-trim a mid-strip video
  and assert (a) its right-edge client x stays ~constant, (b) a left neighbor's
  x decreases, (c) width grows, (d) `data-render-count` on a bystander card is
  unchanged (perf guard), (e) the overview window width tracks the clip width.
- **Playwright e2e** (play-less `TrimOverviewShowcase`, real mouse): drag the
  `[data-trim-handle="left"]` of `vid` left; assert right edge anchored, left
  neighbor pushed left, pill updates, `undo` reverts. Mirror the existing
  `trim handle` e2e structure; needs a settle dwell before release.
- Core `resolveTrim`/`update-media` already covered — no core change expected.

## Edge cases / traps

- **First item (index 0)** has no left neighbor and offset 0 — can't shift left
  past the container start. Decide: clamp to grow-right, or allow the strip to
  scroll (there's no content left of it). The showcase `vid` is index 1, so the
  main path is covered; handle index 0 explicitly.
- Set `scrollLeft` **after** `resizeItem` so the new (larger) total size lets
  the container accept the bigger scroll offset (else it clamps).
- `measure()` fires on commit (nodesById identity) — verify it preserves scroll
  (TanStack does) and that committed size matches the last preview (no flash;
  Phase A already relies on this).
- Auto-scroll (`useEdgeAutoScroll`) and pan (`usePanWithMomentum`) must stay
  disabled during a trim — the handle already `stopPropagation`s; confirm no
  scrollLeft fight.
- Simulated pointer events need `isPrimary: true`; e2e must target the
  play-less story; drags need a settle dwell (repo traps).
- Keep the overview slice out of the card selectors, or the render-efficiency
  guard (`RenderEfficiencyDuringDrag`) will fail.

## Optional Phase B.2

- Make the **overview's** amber handles draggable too (the app trims from the
  source window). Same `previewTrim` path; the overview handle maps pixel delta
  → seconds at the overview's pps (== strip pps), so it stays in sync.

## Open decisions to confirm before building

- **X-alignment**: **RESOLVED — align the window directly over its clip.**
  Shipped independently of the rest of this Phase B plan (the "left grows
  left" scroll-anchor mechanic below): `TrimOverviewStrip` now renders as a
  child of `VirtualStrip`'s own scrolled `contentRef`, positioned via
  `anchorLeft = item.start - trimInSeconds * pixelsPerSecond`, so the amber
  window's edges land exactly on the clip's rendered edges for any trim
  value — see ARCHITECTURE.md's trim section. This also already implements
  this doc's "Live overview sync" section (a widened `TrimPreview.previewTrim`
  carrying live `trimInSeconds`/`trimOutSeconds`, read via a ref in
  `VirtualStrip`, not the store) — the remaining Phase B work (the scroll-
  anchor mechanic + optional draggable overview handles) builds on top of
  this unchanged.
- **First-item left-trim** behavior (clamp vs scroll).
