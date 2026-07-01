# AGENTS.md

## Repo

This is a monorepo with a Next.js app, a Storybook app, and shared UI packages.

- `apps/web` is the Next.js application.
- `apps/storybook` is the Storybook workspace/app.
- `packages/ui` contains framework-agnostic reusable UI components.

## Boundaries

- Do not import Next.js primitives into `packages/ui`.
- UI components should accept injected link, image, or render props when app-specific behavior is needed.
- Do not call production APIs from component stories or tests.

## Validation

Use the closest relevant package scripts for typecheck, lint, tests, and Storybook validation.
