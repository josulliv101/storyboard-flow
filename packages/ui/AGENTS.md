# UI Package Rules

This package must stay framework-agnostic.

Do not import:

- `next/link`
- `next/image`
- Next.js router hooks
- server actions
- app-specific modules

When changing UI components, update Storybook coverage in the Storybook app or existing story location.

For timeline/media components, include stories for selected state, trim handles, missing poster fallback, repeated thumbnails, short clips, long clips, and many-item timelines.
