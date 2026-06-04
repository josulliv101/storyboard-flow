# Editor

Source: `components/editor/Editor.tsx`

## Purpose

Top-level storyboard/timeline application shell. `Editor` wraps `EditorInner` in `TimelineProvider` and owns the full workspace experience.

## When To Use

Use as the page-level component for the app. Real usage: `app/page.tsx` renders `<Editor />`.

## When NOT To Use

Do not render inside another `TimelineProvider`. Do not use as a small embed; it owns full-screen layout, side panels, import/export, saved scenes, render, and analysis workflows.

## Visual Description

Dense dark production UI with top toolbar, side panels, preview, timeline/review workspace, footer status bar, floating modals, and split resizing.

## Dependencies

`TimelineProvider`, `Toolbar`, `Preview`, `ReviewWorkspace`, `TimelineRoot`, `CharactersPanel`, shadcn UI primitives, `motion/react`, `sonner`, `@vercel/blob/client`, `lib/db`, and graph helpers.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Reads and writes timeline state through its provider. |

## Internal State

`EditorInner` owns sidebar tab, workspace split, pending media/project import, render group options, saved-scene dialog state, selected analysis file, script editor target, and side-panel/modal refs.

## Data Flow

Timeline data flows through `useTimeline()`. File uploads create clips and blobs. Import/export uses `TimelineProjectJson`. Analysis/saved-scene workflows update scenes, tracks, clips, and characters through context actions.

## Events

File input changes, workspace resize pointer events, saved scene CRUD, project import/export, render/export, analysis requests, side panel toggles, and script modal open/close.

## Accessibility

Uses real buttons/inputs and `AlertDialog` for destructive saved-scene deletion. Preserve labels, tooltips, and `aria-*` values when adding icon controls.

## Usage Examples

### Minimal Example

```tsx
import { Editor } from "@/components/editor/Editor";

export default function Page() {
  return <Editor />;
}
```

### Typical Example

Same as the real project example in `app/page.tsx`.

### Advanced Example

Generated: mount `Editor` in a page-level test and interact through visible controls rather than bypassing context.

### Real Project Example

`app/page.tsx`.

## Agent Usage Rules

### Always

Use context actions for scene/track/clip changes. Keep `TimelineProvider` as the outer boundary. Preserve import/export normalization and runtime URL stripping.

### Never

Never store `blob:` or `data:` URLs in exported JSON. Never call `useTimeline()` outside the provider. Never delete tracks/blobs outside context actions.

### Common Mistakes

Forgetting that `Editor.tsx` also contains internal components such as `ScriptClipEditorModal` and `ClipPropertiesPanel`.

## Composition Patterns

Composes toolbar, side panels, preview, timeline, review workspace, characters panel, properties panel, and script editor modal.

## Styling Rules

Use the existing compact dark zinc/indigo system, uppercase micro-labels, icon controls, and shadcn wrappers.

## Performance Considerations

This file touches many state paths. Memoize derived clip/scene/track data and avoid effects that rescan all media on each render.

## Testing Guidance

Test import/export normalization, saved-scene flows, script editor save, render/analysis failures, and workspace mode switching.

## Common Modification Tasks

For a new setting: update context type/defaults, persistence/export config, editor controls, and preview/timeline consumers.

## Related Components

`Toolbar`, `Preview`, `ReviewWorkspace`, `TimelineRoot`, `CharactersPanel`, `ScriptClipEditorModal`.

## Architecture Notes

The app is context-centric. `lib/timeline-context.tsx` handles normalization, persistence, blob cleanup, ID remapping, and active-scene behavior.

## AI Agent Summary

Purpose: Full editor shell.
Inputs: No props.
Outputs: Complete timeline editor UI and context mutations.
Dependencies: Timeline context, editor children, storage, motion, shadcn.
Critical Rules: Use context actions; preserve provider and serialization contracts.
Common Pitfalls: Treating internal modal/panel components as independent public APIs.
Safe Modifications: Add settings through context, then wire all consumers.

