# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

npm-workspaces monorepo (no turbo/nx — plain workspace scripts).

- `apps/web` — the Next.js application (Remotion rendering, Gemini, Firebase, Vercel Blob). Also hosts the Playwright e2e suite for the UI packages (`tests/e2e/`), which runs against the **Storybook** iframe, not the Next app.
- `apps/storybook` — Storybook workspace, and the place ALL vitest tests run from (both projects, see Commands).
- `apps/backend` — Python service (`main.py`, venv); `npm run setup:backend` / `npm run dev:backend` from the root.
- `packages/ui` (`@storyboard/ui`) — framework-agnostic UI components. No package scripts; typecheck and tests run from elsewhere (see Commands).
- `packages/db` (`@storyboard/db`) — shared db layer, also script-less.

There are per-package agent instruction files that take precedence closest to the files being edited: root `AGENTS.md`, `packages/ui/AGENTS.md`, `apps/storybook/AGENTS.md`.

## Commands

Install once at the root: `npm install`.

| Task | Where | Command |
| --- | --- | --- |
| Run the web app | root | `npm run dev:frontend` |
| Run Storybook (port 6006) | root | `npm run storybook` |
| Unit tests (pure logic in `packages/ui`) | `apps/storybook` | `npx vitest run --project=unit` |
| Story interaction tests (real headless Chromium) | `apps/storybook` | `npx vitest run --project=storybook` |
| One story file | `apps/storybook` | `npx vitest run --project=storybook DndCollections.stories.tsx` |
| One test by name | `apps/storybook` | add `--testNamePattern "name"` |
| Typecheck the UI package | `packages/ui` | `npx tsc --noEmit -p tsconfig.json` |
| E2E (Playwright, real mouse) | `apps/web` | `npx playwright test` (or a filter, e.g. `npx playwright test dnd-collections`) |
| Lint the web app | `apps/web` | `npm run lint` |

Non-obvious wiring:

- `apps/storybook/vitest.config.ts` defines both vitest projects. `unit` is a node-env project whose include globs reach into `../../packages/ui/**/*.test.ts` — that's why UI package unit tests run from the storybook workspace.
- The `storybook` project runs every story's `play` function in headless Chromium via `@vitest/browser-playwright`. Stories ARE the interaction test suite.
- Playwright's `webServer` (in `apps/web/playwright.config.ts`) auto-starts Storybook with `npm --prefix ../storybook run storybook`; it reuses an already-running instance on 6006.

## Architecture

### packages/ui: two documented drag-and-drop systems

- `packages/ui/media-strip` — timeline media strip with an **adapter layer** over three DnD backends (dnd-kit, pragmatic, native HTML5; pragmatic is experimental). Read `packages/ui/media-strip/ARCHITECTURE.md` before structural changes; `README.md` has the consumer quickstart.
- `packages/ui/dnd-collections` — collections graph DnD built on dnd-kit: a normalized graph as single source of truth, a pure command reducer as the only mutation path, reversible patches backing undo/redo and the `onChange` feed, and a selector store so drags don't re-render uninvolved cards. Read `packages/ui/dnd-collections/ARCHITECTURE.md` (design/invariants) and `API.md` (exports) before touching it.

Both packages follow the same discipline: pure `core/` logic with no React/DOM imports, React bindings layered on top, and mutation flowing through one typed command/reducer path that returns `Result`-shaped rejections instead of throwing.

### Testing strategy (layered, applies to both DnD packages)

1. Unit tests (`core/*.test.ts`) for pure logic.
2. Story `play` functions for interaction coverage — simple clicks/toggles per `apps/storybook/AGENTS.md`, but these repos also drive simulated pointer drags here.
3. Playwright e2e in `apps/web/tests/e2e/` for real trusted mouse input (drag, scrub, scroll, pointer capture, virtualization).

Hard-won traps, all previously lost time:

- Simulated `PointerEvent`s must set `isPrimary: true` or dnd-kit's PointerSensor silently ignores the whole sequence.
- Playwright e2e must target **play-less** stories: Storybook auto-runs `play()` on iframe load, and its synthetic `pointerup` kills a concurrently running real-mouse drag.
- A held modifier across multiple `userEvent` clicks requires one `userEvent.setup()` session (the static API resets keyboard state per call).

## Rules (from AGENTS.md files — follow these)

- `packages/ui` stays framework-agnostic: no `next/link`, `next/image`, Next router hooks, server actions, or app-specific modules. Inject links/images/render props where app behavior is needed.
- Never use `any`.
- Prefer composition (children, compound components, slots) over boolean/mode props on large configurable components; split responsibilities before adding props.
- Storybook app: deterministic fake data only — no Firebase, Cloudinary, or live API calls from stories or tests.
- When changing UI components, update Storybook coverage. Timeline/media components need stories for: selected state, trim handles, missing poster fallback, repeated thumbnails, short/long clips, many-item timelines.
