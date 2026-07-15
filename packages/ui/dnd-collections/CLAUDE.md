# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Package-scoped guidance for `packages/ui/dnd-collections`. Read
[ARCHITECTURE.md](./ARCHITECTURE.md) before structural changes (it explains
the why behind everything below); [API.md](./API.md) documents every export.
Repo-wide rules live in the root CLAUDE.md and `packages/ui/AGENTS.md`.

## Commands

| Task | Where | Command |
| --- | --- | --- |
| Unit tests | `apps/storybook` | `npx vitest run --project=unit` (filter: append `intents`, `commands`, …) |
| Story interaction tests | `apps/storybook` | `npx vitest run --project=storybook` (name a file to narrow: `DndCollections.stories.tsx`, `PaletteTrash.stories.tsx`, `VirtualStrip.stories.tsx`, `VirtualGrid.stories.tsx`) |
| Typecheck | `packages/ui` | `npx tsc --noEmit -p tsconfig.json` |
| E2E (real mouse) | `apps/web` | `npx playwright test dnd-collections` |

## Invariants — do not break these

- **`core/` stays pure.** No React, DOM, or dnd-kit imports. Anything that
  needs them belongs in `react/`.
- **The graph mutates only through `applyCommand`**, and `applyPatch` is the
  only code that rewrites children/parent indexes (forward apply, undo, and
  redo all share it). Never mutate the committed graph during a drag — the
  live preview is interaction state in the store, applied as a command only
  on drop. This is also why `useSortable` is deliberately not used.
- **`toIndex` is a post-removal index** (target's children with the moved
  nodes already removed). Only `resolveCommandFromIntent` and
  `resolveKeyboardCommand` do that math; don't reimplement it elsewhere.
- **Roots are unmovable** (`cannot-move-root`); `rootIds` is not part of the
  patch model.
- **Snapshot-field identity is a contract.** Store snapshot fields keep
  their reference unless they actually changed (see the cached
  `historyEntries` — `history.entries()` allocates per call and must not run
  in `buildSnapshot`). Selectors passed to `useCollectionsSelector` must
  return primitives or references stable while the slice is unchanged;
  per-call allocations in a selector defeat the package's render-efficiency
  model. `RenderEfficiencyDuringDrag` (via `data-render-count`) fails if a
  bystander card re-renders during a drag — keep it passing.
- **Preview validity must equal commit outcome.** `isIntentInvalid` and the
  reducer enforce the same cycle rule; if you change one, change both (they
  share `isSameOrAncestor` — keep it that way).
- **The shell/content boundary is the customization seam.** `NodeCard` is a
  visually transparent interaction shell; ALL pixels live in the content
  component (`DefaultItemContent` or a consumer's, via the provider
  `components` registry / per-view `itemContent`). Never paint in the shell,
  never move behavior (wiring, aria, trim handles, listener placement) into
  content, and keep content components identity-stable — an inline component
  definition remounts every card's content per render.
- **Displaced siblings don't re-render**, so per-card effects never fire for
  the cards a commit moved — that's why FLIP is a single graph-identity
  sweep in `use-flip-graph-animation.ts`. Don't convert it to per-card
  effects, and don't let animation code influence the reducer. The sweep is
  scoped to the provider's container (via `container-context.ts`) so
  multiple instances stay isolated — never widen it back to the document.
- New public exports go through the curated `index.ts`.

## Testing rules

New behavior gets coverage at the right layer: pure logic in
`core/*.test.ts`, interaction in a story `play` function, and an
`apps/web/tests/e2e/dnd-collections.spec.ts` test when trusted pointer input
matters. Traps that have already cost diagnosis time:

- Simulated `PointerEvent`s need `isPrimary: true` (see
  `stories-helpers.ts`) or PointerSensor ignores the sequence silently.
- E2E must target **play-less** stories (`Playground`, `CycleFixture`):
  Storybook auto-runs `play()` on iframe load and its synthetic `pointerup`
  ends a real-mouse drag mid-flight. If a play story needs an e2e twin,
  add a play-less fixture story.
- A held modifier across clicks needs one `userEvent.setup()` session.
- Drags need a settle dwell before release (`dragToPoint` does this); dnd-kit
  recomputes `over` on a measure cadence and releasing early is the classic
  CI-only flake.
