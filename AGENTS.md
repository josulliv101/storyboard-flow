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
- Codex-gated by DEFAULT; the source issue's `chore` label is the skip lane:
  - **default** (bug, feature, anything non-`chore`): claude-implement does NOT
    arm auto-merge; it labels the PR `gated`, which fires `codex-gate.yml`.
    That gate waits up to 12 min for Codex's verdict, then arms auto-merge
    **only** on approval (👍 reaction or a formal APPROVED review). Findings, or
    silence past the window, leave the PR open and ping you. This is the "give
    Codex time, be out of the loop only when it approves" path — a bug worth
    filing is worth a review.
  - **chore** (`chore` label): the skip lane — auto-merge is armed at PR open
    and lands on green CI + merge guard, no Codex gate. For genuinely trivial
    changes (comment, version bump, rename); use it discriminately.
  - `hold` vetoes either lane.
- Auto-fix loop, from BOTH reviewers:
  - **Codex findings** (`codex-gate.yml`): a changes-requested review or inline
    comments → posts an `@claude` request → `claude-implement.yml`'s `@claude`-
    on-a-PR path fixes on the branch and pushes → the workflow re-applies
    `gated` and `@codex review`s → the gate re-evaluates the new commit. The
    gate only counts Codex signals NEWER than the head commit, so a prior
    round's findings never re-trigger.
  - **CI failures** (`ci-autofix.yml`): a failing `CI` run on a loop PR →
    posts an `@claude` request with the failing output → same fix path. This
    catches types/lint/tests that Codex structurally can't (it doesn't run the
    suite), which would otherwise strand a Codex-approved PR on a red required
    check.
  - Both share ONE 5-round cap (every request comment contains "autofix"); at
    the cap the responsible workflow adds `hold` and pings the owner. `hold`
    breaks the loop anytime.
- There is deliberately no branch-protection-required approval: Codex's signal
  is informal (reaction/comments), so the gate POLLS for it rather than gating
  a required check. The `hold` label is the universal brake.
- Codex review is the NATIVE GitHub integration (chatgpt.com/codex), on the
  Codex subscription. "Enable credits use" stays OFF so it can never spill into
  paid credits. There is no API-billed Codex in CI: `OPENAI_API_KEY` is never
  created or stored (hard constraint).
- Filing the next issue (the "scout") stays manual — owner-seeded, or a Codex
  cloud task — because subscription Codex cannot do it in CI and an unattended
  auto-scout is the most likely thing to run away.

<!-- Codex auto-review enabled on this repo (native GitHub integration, advisory). -->
