# Storybook App Rules

This app is only for developing, previewing, and testing UI components.

- Import components from `packages/ui`.
- Use deterministic fake data.
- Do not call Firebase, Cloudinary, or live APIs.
- Use local or static placeholder media where possible.
- Use typed CSF stories with `Meta` and `StoryObj`.
- Use `play` tests for simple click, toggle, and select behavior.
- Use Playwright for real drag, scrub, scroll, pointer capture, video playback, and virtualization behavior.
