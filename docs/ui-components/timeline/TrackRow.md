# TrackRow

Source: `components/editor/TrackRow.tsx`

## Purpose

Renders one timeline row or graph row. Handles row-level insertion, drag/drop import, context-menu insertion, gap insertion, and graph point editing.

## When To Use

Use inside `TimelineRoot` for visible child tracks.

## When NOT To Use

Do not use for parent group headers or outside `TimelineProvider`.

## Visual Description

Non-graph rows are 48px lanes with clips and add/drop affordances. Graph rows show compact line/bar plots, nodes, note tooltips, lasso selection, and a floating node editor.

## Dependencies

`useTimeline`, `ClipItem`, shadcn dropdown/button components, lucide icons, `cn`, graph helpers.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `track` | `TimelineTrack` | yes | none | Track or graph track to render. |
| `sceneClips` | `TimelineClip[]` | no | context `clips` | Scene-specific clips for multi-scene mode. |
| `sceneTracks` | `TimelineTrack[]` | no | context `tracks` | Scene-specific tracks for multi-scene mode. |
| `sceneId` | `string` | no | none | Activates scene on row interaction. |

## Internal State

Context menu position, drag-over flag, graph node editor, selected graph frames, graph lasso, row ref, and graph drag movement ref.

## Data Flow

Filters row clips by `track.id` and renders `ClipItem`. Creates clips through `addClip`. Updates graph points through `updateTrack`.

## Events

Right-click opens add menu. Drag/drop accepts image/video files and creates sequential clips. Graph pointer events add, drag, select, edit, and delete points. Delete/Backspace removes selected line-graph nodes when focus is not in an input.

## Accessibility

Menus/buttons are keyboard-reachable. Graph editing is pointer-heavy; add keyboard alternatives if graph editing becomes accessibility-critical.

## Usage Examples

### Minimal Example

```tsx
<TrackRow track={track} />
```

### Typical Example

```tsx
<TrackRow track={child} sceneClips={scene.clips} sceneTracks={scene.tracks} sceneId={scene.id} />
```

### Advanced Example

Generated: pass a graph track with `graph.points` to verify node editing.

### Real Project Example

`TimelineRoot` maps visible child tracks to `TrackRow`.

## Agent Usage Rules

### Always

Route graph updates through `updateTrack`. Clamp values to graph `min/max`. Preserve default line graph endpoints and bar interval point generation.

### Never

Never mutate `track.graph.points` in place. Never delete line graph endpoints at frame `0` or `totalDuration`.

### Common Mistakes

Ignoring `sceneClips` and `sceneTracks` in multi-scene mode.

## Composition Patterns

Parent of `ClipItem`; owned by `TimelineRoot`.

## Styling Rules

Keep `h-12`; `ClipItem` vertical drag assumes 48px track height.

## Performance Considerations

Graph pointer drag updates rapidly. Keep handlers small and avoid extra derived work.

## Testing Guidance

Test file drop ordering, gap insertion, context-menu frame math, graph validation, lasso node selection, and Delete/Backspace behavior.

## Common Modification Tasks

To add a clip type, update `ClipType`, row menus, `ClipItem`, `Preview`, defaults, and tests.

## Related Components

`ClipItem`, `TimelineRoot`, `Preview`, `ReviewWorkspace`.

## Architecture Notes

Bar graphs synthesize evenly spaced points from `barIntervalSeconds`.

## AI Agent Summary

Purpose: Timeline lane and graph editor row.
Inputs: Track plus optional scene overrides.
Outputs: Adds clips and updates graph/track state.
Dependencies: `ClipItem`, timeline context, graph helpers.
Critical Rules: Preserve 48px row math and immutable graph updates.
Common Pitfalls: Ignoring scene overrides.
Safe Modifications: Extend menus and update clip-type consumers together.

