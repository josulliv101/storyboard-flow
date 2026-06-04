# TimelineRoot

Source: `components/editor/TimelineRoot.tsx`

## Purpose

Main timeline editing surface: ruler/header, grouped track sidebar, layer sections, scrollable rows, lasso selection, layer menus, copy/paste, and graph configuration.

## When To Use

Use inside `TimelineProvider` when `workspaceViewMode` is `editor`.

## When NOT To Use

Do not use in review mode; use `ReviewWorkspace`.

## Visual Description

Fixed left sidebar, horizontal ruler, parent groups, media/dialog/notes/graph sections, track rows, snap/playhead overlays, and graph editor modal.

## Dependencies

`useTimeline`, `TrackRow`, `Ruler`, `Playhead`, shadcn menus/buttons, `sonner`, `motion/react`, graph helpers.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Reads timeline context directly. |

## Internal State

Lasso coordinates, rename state, graph editor form state, copied layer, input ref, and scroll sync refs.

## Data Flow

Reads scenes/tracks/clips from context. Sidebar actions call context actions. Header/content/sidebar scroll positions are synchronized. Lasso writes `selectedClipIds`.

## Events

Ruler/content pointer down sets current frame. Lasso pointer move/up selects clips. Menus rename, duplicate, add, mute, disable, delete, copy/paste, and configure layers.

## Accessibility

Uses buttons, menus, and inputs. Preserve keyboard behavior for rename inputs and graph editor fields.

## Usage Examples

### Minimal Example

```tsx
<TimelineProvider>
  <TimelineRoot />
</TimelineProvider>
```

### Typical Example

Rendered by `EditorInner` when not in review mode.

### Advanced Example

Generated: seed context with multiple scenes and graph layers to test grouping and lasso.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Preserve media/dialog/notes/graph grouping. Keep scene-specific `scene.tracks` and `scene.clips` passed to `TrackRow` in multi-scene mode. Validate graph ranges and colors before saving.

### Never

Never bypass `updateTrack`, `deleteTrack`, `addGraphTrack`, or `setSelectedClipIds`. Never allow graph `max <= min`.

### Common Mistakes

Treating graph tracks as ordinary media layers.

## Composition Patterns

Owns timeline structure and delegates row rendering to `TrackRow`, ticks to `Ruler`, and current-frame display to `Playhead`.

## Styling Rules

Keep `w-64` sidebar and `h-12` row height stable; lasso and row alignment depend on those constants.

## Performance Considerations

Grouping and lasso scan scenes/tracks/clips. Keep derived helpers memoized/callback-based.

## Testing Guidance

Test lasso, group collapse, section collapse, graph create/edit validation, copy/paste restrictions, and multi-scene rendering.

## Common Modification Tasks

To add a layer kind, update `LayerSectionId`, `LAYER_SECTIONS`, `getLayerKind`, icons, menus, and tests.

## Related Components

`TrackRow`, `ClipItem`, `Ruler`, `Playhead`, `ReviewWorkspace`.

## Architecture Notes

Section collapse IDs are synthetic: `${parentId}::layer-section::${sectionId}`.

## AI Agent Summary

Purpose: Main timeline editing surface.
Inputs: Timeline context.
Outputs: Track/clip selection and editing through context.
Dependencies: `TrackRow`, `Ruler`, `Playhead`, graph helpers.
Critical Rules: Preserve row math, grouping, and graph validation.
Common Pitfalls: Misclassifying graph layers.
Safe Modifications: Add layer/action changes through context and tests.

