# Preview

Source: `components/editor/Preview.tsx`

## Purpose

Live visual output renderer for the current timeline frame: media, overlays, dialog, notes, graph values, and multi-scene/multi-group layouts.

## When To Use

Use in the editor shell wherever scene output should be shown.

## When NOT To Use

Do not use for timeline clip editing.

## Visual Description

Aspect-ratio framed preview with inset/full media, graph cards/rails, compact note tags, dialog cards, note overlays, and multiple preview frames.

## Dependencies

`useTimeline`, `ResponsiveAspectFrame`, `motion/react`, `lib/render-layout`, graph helpers, lucide icons.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Reads preview data/settings from context. |

## Internal State

`PreviewVideo` owns video refs/readiness. Note overflow helpers measure with refs, `ResizeObserver`, and animation frames.

## Data Flow

Filters active clips by current frame, disabled/muted tracks, preview scenes, note tags, media layout, graph tracks, and group settings. Video playback syncs with frame/fps/rate/play state.

## Events

Listens for `timeline-preview-play-request` to start videos from a user-initiated playback path.

## Accessibility

Mostly visual. Media image paths use `alt={clip.name}` in some branches; dialog headshots may be decorative.

## Usage Examples

### Minimal Example

```tsx
<TimelineProvider>
  <Preview />
</TimelineProvider>
```

### Typical Example

Rendered in `EditorInner` preview pane.

### Advanced Example

Generated: seed graph tracks, notes, disabled tracks, and multiple preview scenes to verify overlay filtering.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Keep filtering consistent with `Toolbar` and `ReviewWorkspace`. Preserve video sync and graph helper usage.

### Never

Never assume a clip with `src` is image/video without checking `clip.type`. Never add expensive per-frame work without memoization.

### Common Mistakes

Forgetting muted parent groups when rendering video audio.

## Composition Patterns

Uses `ResponsiveAspectFrame` and render-layout helpers for grid/overlay placement.

## Styling Rules

Keep overlay text bounded. Preserve inset media constants when graph rail layout depends on them.

## Performance Considerations

Updates on playback frame changes; memoize derived group/clip/graph data.

## Testing Guidance

Storybook covers layout contracts. Add tests for media layout, filters, graph values, muted playback, and multi-scene previews.

## Common Modification Tasks

For a new overlay style: update context setting, toolbar, preview branch, export/import config, and layout stories.

## Related Components

`Toolbar`, `ReviewWorkspace`, `ResponsiveAspectFrame`, `ClipItem`.

## Architecture Notes

Graph-linked notes can link by `linkedGraphTrackIds` or by matching graph name/label/short label tags.

## AI Agent Summary

Purpose: Live visual output.
Inputs: Timeline context.
Outputs: Preview DOM/media playback.
Dependencies: render-layout, graph helpers, aspect frame.
Critical Rules: Keep playback sync and shared filtering intact.
Common Pitfalls: Expensive per-frame recalculation.
Safe Modifications: Add overlay features with memoized selectors and stories.

