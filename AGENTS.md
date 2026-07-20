# AGENTS.md

## Repo

This is a monorepo with a Next.js app, a Storybook app, and shared UI packages.

- `apps/timeline-gstudio001` is the Next.js application.
- `apps/storybook` is the Storybook workspace/app.
- `packages/ui` contains framework-agnostic reusable UI components.

## Monorepo package instructions

This repo has package-specific agent instructions.

When working on files under `packages/ui`, also read and follow:

- `packages/ui/AGENTS.md`

When working on files under `apps/storybook`, also read and follow:

- `apps/storybook/AGENTS.md`

When work crosses both `packages/ui` and `apps/storybook`, follow both package instruction files. If instructions conflict, prefer the instruction file closest to the files being edited.

## Boundaries

- Do not import Next.js primitives into `packages/ui`.
- UI components should accept injected link, image, or render props when app-specific behavior is needed.
- Do not call production APIs from component stories or tests.

## Validation

Use the closest relevant package scripts for typecheck, lint, tests, and Storybook validation.

## Typescript

- never opt out of typing by using any

## Cloud agent collaboration

A two-agent loop runs on GitHub Actions (see `.github/workflows/`). Roles:

- **Codex owns review and issue tracking.** A review that finds an actionable
  problem outside the PR's scope searches open AND closed issues for
  duplicates, then files ONE consolidated GitHub issue with priority,
  evidence (`file:line`), acceptance criteria, and the expected regression
  test. Related findings from the same subsystem consolidate into one issue
  unless they need independent ownership or release timing.
- **Claude owns implementation.** It picks up one labeled issue, makes the
  smallest complete change with focused regression coverage, and opens a PR.
  One implementation issue per PR unless the issue defines an atomic
  multi-part change.
- **No bot triggers another bot automatically.** Work enters the loop only
  through an owner-authored `claude` label or `@claude` mention; PR creation
  is the handoff to review. This owner gate is deliberate — it is the manual
  brake while the loop is young.

Mechanics the workflows depend on:

- The `claude` label (or `@claude`) starts implementation; the `hold` label
  vetoes a PR's auto-merge at any time.
- PRs are opened with `LOOP_PAT` (not the default Actions token) so CI and the
  merge guard actually fire — a token-created PR triggers no downstream
  workflow.
- Auto-merge lands a PR once CI is green and the merge guard passes; `hold`
  holds it. Adding a required approval (Codex's) is the later, closed-loop
  upgrade and needs a reviewer identity distinct from the PR author.
- The Codex review and scout workflows are the PAID tier — dormant until
  `CODEX_ENABLED=true` and `OPENAI_API_KEY` exist, because `openai/codex-action`
  is API-billed (no ChatGPT-subscription auth in CI).
