# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

npm-workspaces monorepo (no turbo/nx — plain workspace scripts).

- `apps/timeline-gstudio001` — the Next.js application (Firebase auth/storage, Cloudinary assets, the graph view). Has its own vitest suite (`npx vitest run` — app routes/lib + `packages/ui/timeline` tests), its own Storybook on port 6007, and its own Playwright e2e (`tests/e2e/`; the `graph-view` project runs against the real app on :3000 with per-test API mocks).
- `apps/storybook` — Storybook workspace (port 6006, serves `packages/ui` + gstudio component stories), and the place the shared vitest projects run from (see Commands). Self-contained: its Tailwind entry/tokens live in `.storybook/globals.css`.
- `packages/ui` (`@storyboard/ui`) — framework-agnostic UI components. No package scripts; typecheck and tests run from elsewhere (see Commands).
- `packages/db` (`@storyboard/db`) — shared db layer, also script-less.
- `packages/timeline-model` (`@storyboard/timeline-model`) — the PURE stored timeline model: document/clip types, packing constants, and document functions (`packTimelineClips`, `previewItemsFrom`, folder-path helpers…). No dependencies. `packages/ui/timeline` re-exports all of it, so `@storyboard/ui/timeline/{types,constants,timeline-documents}` imports keep working — but server routes and domain code should import from here.
- `packages/collections-core` (`@storyboard/collections-core`) — the framework-free dnd-collections engine core (graph, commands, patches, history, hydrate…; no React/dnd-kit). Import it directly, by subpath: `@storyboard/collections-core/graph`, `/commands`, `/patches`, `/history`, `/hydrate`, `/intents`, `/keyboard`, `/numeric`. The `packages/ui/dnd-collections/core/*` re-export shims that used to forward these are **gone** — there is one path to the engine now, and it is the package.
- `packages/timeline-domain` (`@storyboard/timeline-domain`) — the TimelineDocument ⇄ CollectionsGraph adapter. Runtime deps are ONLY the two packages above; `@storyboard/ui` is a devDependency for test fixtures.

There are per-package agent instruction files that take precedence closest to the files being edited: root `AGENTS.md`, `packages/ui/AGENTS.md`, `apps/storybook/AGENTS.md`.

## Commands

Install once at the root: `npm install`.

| Task | Where | Command |
| --- | --- | --- |
| Run the app | `apps/timeline-gstudio001` | `npm run dev` |
| Run Storybook (port 6006) | root | `npm run storybook` |
| Unit tests (pure logic in `packages/ui`) | `apps/storybook` | `npx vitest run --project=unit` |
| Story interaction tests (real headless Chromium) | `apps/storybook` | `npx vitest run --project=storybook` |
| One story file | `apps/storybook` | `npx vitest run --project=storybook DndCollections.stories.tsx` |
| One test by name | `apps/storybook` | add `--testNamePattern "name"` |
| Typecheck the UI package | `packages/ui` | `npx tsc --noEmit -p tsconfig.json` |
| App tests (routes, gateway, model) | `apps/timeline-gstudio001` | `npx vitest run` |
| E2E (Playwright, real mouse) | `apps/timeline-gstudio001` | `npx playwright test --project=graph-view` |
| Lint the app | `apps/timeline-gstudio001` | `npm run lint` |

Non-obvious wiring:

- `apps/storybook/vitest.config.ts` defines both vitest projects. `unit` is a node-env project whose include globs reach into `../../packages/ui/**/*.test.ts` — that's why UI package unit tests run from the storybook workspace.
- The `storybook` project runs every story's `play` function in headless Chromium via `@vitest/browser-playwright`. Stories ARE the interaction test suite.
- Playwright's `webServer` (in `apps/timeline-gstudio001/playwright.config.ts`) auto-starts the app's own Storybook (:6007) AND `next dev` (:3000); `reuseExistingServer` is always true for the dev server — never boot a second `next dev` against a shared `.next`.

## Architecture

### packages/ui: the drag-and-drop system

- `packages/ui/dnd-collections` — collections graph DnD built on dnd-kit: a normalized graph as single source of truth, a pure command reducer as the only mutation path, reversible patches backing undo/redo and the `onChange` feed, and a selector store so drags don't re-render uninvolved cards. Read `packages/ui/dnd-collections/ARCHITECTURE.md` (design/invariants) and `API.md` (exports) before touching it.

Its discipline: pure `core/` logic with no React/DOM imports, React bindings layered on top, and mutation flowing through one typed command/reducer path that returns `Result`-shaped rejections instead of throwing.

There used to be a second one — `packages/ui/media-strip`, an adapter layer over three DnD backends — plus a legacy timeline viewport (`SmoothScrollList` and its hooks) driving the old routes. Both are gone, along with `media-strip-base`, `wheel-picker`, `charts` and `drag-drop`: a reachability walk found nothing imported them. They looked live only because `packages/ui/index.ts` re-exported them and grep can't tell a barrel from a consumer. **Nothing imports the bare `@storyboard/ui`** — the package is consumed entirely by subpath — so an `export *` in that barrel is not evidence of use.

`npm run audit:ui` re-runs the walk (`scripts/find-unreachable-ui.mjs`); `--dir <name>` answers "is any file in this folder still imported?" before you delete one. Two things it deliberately cannot tell you, both of which have already nearly caused a bad deletion:

- **Stories and tests are excluded from its seed set**, so every cover file reports as unreachable whether or not its subject is live. Check the subject before deleting a `.stories.tsx` / `.test.ts` — the name may not match the module it covers (`WorkbenchSplitPane.stories.tsx` covers `workbench-display-surface.tsx`).
- **It only sees imports.** A route entered from outside the app is a link-graph orphan but very much alive — `/oauth/authorize` is the connector consent page, advertised as `authorization_endpoint` in `lib/oauth/metadata.ts`.

What survives in `packages/ui/timeline` is exactly what the graph path imports: `types`, `constants`, `utils`, `timeline-documents`, `timeline-document-store`, `hooks/use-timeline-clips`, and `viewport/workbench-display-surface` (the graph's preview pane).

### Testing strategy (layered)

1. Unit tests (`core/*.test.ts`) for pure logic.
2. Story `play` functions for interaction coverage — simple clicks/toggles per `apps/storybook/AGENTS.md`, but these repos also drive simulated pointer drags here.
3. Playwright e2e in `apps/timeline-gstudio001/tests/e2e/` for real trusted mouse input (drag, scrub, scroll, pointer capture, virtualization) — the `graph-view` project drives the DnD packages inside the real app.

Hard-won traps, all previously lost time:

- Simulated `PointerEvent`s must set `isPrimary: true` or dnd-kit's PointerSensor silently ignores the whole sequence.
- Playwright e2e must target **play-less** stories: Storybook auto-runs `play()` on iframe load, and its synthetic `pointerup` kills a concurrently running real-mouse drag.
- A held modifier across multiple `userEvent` clicks requires one `userEvent.setup()` session (the static API resets keyboard state per call).
- dnd-kit keeps a document-capture click SUPPRESSOR armed for **50ms after a drop** (`AbstractPointerSensor.detach` defers its listener removal). A button clicked inside that window is silently eaten — its click passes `window` but never reaches React. Wait ~80ms after `mouse.up` before clicking anything (the e2e `holdDrag` helper does).
- Never measure card geometry mid-FLIP: commits (drop/undo/redo) animate displaced cards for 180ms and `getBoundingClientRect` includes the transform, so a drag measured then releases at a stale coordinate and resolves the wrong intent. Settle move animations first (see `settleMoveAnimations` in the e2e spec).

## Rules (from AGENTS.md files — follow these)

- `packages/ui` stays framework-agnostic: no `next/link`, `next/image`, Next router hooks, server actions, or app-specific modules. Inject links/images/render props where app behavior is needed.
- Never use `any`.
- Prefer composition (children, compound components, slots) over boolean/mode props on large configurable components; split responsibilities before adding props.
- Storybook app: deterministic fake data only — no Firebase, Cloudinary, or live API calls from stories or tests.
- When changing UI components, update Storybook coverage. Timeline/media components need stories for: selected state, trim handles, missing poster fallback, repeated thumbnails, short/long clips, many-item timelines.
