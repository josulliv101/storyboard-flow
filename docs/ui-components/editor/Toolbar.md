# Toolbar

Source: `components/editor/Toolbar.tsx`

## Purpose

Playback, clip insertion, note/graph preview filters, time display, selected-clip deletion, aspect ratio, and zoom controls.

## When To Use

Use in the main editor shell inside `TimelineProvider`.

## When NOT To Use

Do not use outside timeline context or as a generic toolbar.

## Visual Description

Compact 48px dark toolbar with optional scene tabs, centered playback controls, filter menu, speed selector, add-item menu, aspect selector, and zoom slider.

## Dependencies

`useTimeline`, `Button`, `Slider`, `Tooltip`, `DropdownMenu`, lucide icons, `cn`, and graph display helpers.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Reads and writes timeline context directly. |

## Internal State

Hidden file input ref and `pendingType` for video/image insertion.

## Data Flow

Derives preview scenes, note tag counts, graph-layer visibility, active filter labels, and scene tabs from context. Writes playback, filters, aspect, zoom, deletion, and clip creation through context.

## Events

Play dispatches `timeline-preview-play-request` before setting playing. Add Item creates dialog/note clips or opens a media file input. Filter menu toggles preview UI, graph layers, and note tag filters.

## Accessibility

Uses tooltip/menu primitives. Filter trigger has `aria-label="Filter notes"`; toggle-like controls use `aria-pressed`.

## Usage Examples

### Minimal Example

```tsx
<TimelineProvider>
  <Toolbar />
</TimelineProvider>
```

### Typical Example

Rendered by `EditorInner` above the workspace.

### Advanced Example

Generated: seed graph tracks and tagged notes, then verify filter menu state and cleanup.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Dispatch `timeline-preview-play-request` before starting playback. Keep note filter behavior consistent with `Preview` and `ReviewWorkspace`.

### Never

Never add toolbar-only state for preview-wide settings. Never let stale note filters persist when tags disappear.

### Common Mistakes

Changing note/graph filtering here without updating consumers.

## Composition Patterns

Coordinates with preview, timeline, and review views entirely through shared context.

## Styling Rules

Keep controls compact. Prefer icons for commands and sliders/dropdowns for numeric or option controls.

## Performance Considerations

Memoize derived tag and graph summaries; they scan scenes/tracks/clips.

## Testing Guidance

Test playback event dispatch, add-item defaults, filter cleanup, aspect selection, zoom slider, and deletion disabled state.

## Common Modification Tasks

For a new preview filter, add context state first, then update toolbar controls, preview/review consumers, export/import config, and tests.

## Related Components

`Preview`, `ReviewWorkspace`, `TimelineRoot`.

## Architecture Notes

The sentinel `__NO_NOTE_TAGS_VISIBLE__` is used to hide all note overlays/cards.

## AI Agent Summary

Purpose: Top editor control bar.
Inputs: Timeline context.
Outputs: Playback, filters, clip creation, zoom/aspect changes.
Dependencies: shadcn UI and timeline context.
Critical Rules: Keep filter state shared and playback event dispatch intact.
Common Pitfalls: Updating toolbar only for preview behavior.
Safe Modifications: Add context-backed controls and wire consumers.

