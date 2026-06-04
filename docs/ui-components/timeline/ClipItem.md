# ClipItem

Source: `components/editor/ClipItem.tsx`

## Purpose

Interactive timeline clip block. Handles selection, multi-selection, dragging, resizing, snapping, and clip identity display.

## When To Use

Use inside `TrackRow` for clips belonging to that row.

## When NOT To Use

Do not use for preview rendering; `Preview` has separate rendering.

## Visual Description

Absolute-positioned colored block with type icon/avatar, optional media thumbnail background, drag handle, resize handles, selected ring, and hover metadata.

## Dependencies

`useTimeline`, `motion/react`, `cn`, graph helpers, lucide icons.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `clip` | `TimelineClip` | yes | none | Clip to render/edit. |
| `sceneClips` | `TimelineClip[]` | no | context `clips` | Used for snapping and multi-scene mode. |
| `sceneTracks` | `TimelineTrack[]` | no | context `tracks` | Used for vertical moves and graph-link display. |
| `sceneId` | `string` | no | none | Activates scene on interaction. |

## Internal State

`isDragging`; derived selected state, linked character, linked graph colors, and visible child tracks.

## Data Flow

Reads zoom/selection/tracks/clips/characters from context. Updates `startFrame`, `duration`, and `trackId` through `updateClip`. Sets snap-line and interaction flags during drag/resize.

## Events

Pointer down selects or starts drag. Shift/Cmd/Ctrl toggles multi-select. Drag changes frame and optionally track. Resize handles adjust start or duration with snapping.

## Accessibility

Pointer-first component with no keyboard move/resize behavior. Preserve visible text and consider keyboard support for accessibility hardening.

## Usage Examples

### Minimal Example

```tsx
<ClipItem clip={clip} />
```

### Typical Example

```tsx
<ClipItem key={clip.id} clip={clip} sceneClips={rowClips} sceneTracks={rowTracks} sceneId={sceneId} />
```

### Advanced Example

Generated: render a note with `linkedGraphTrackIds` and graph tracks to verify graph color dots.

### Real Project Example

`TrackRow` maps row clips to `ClipItem`.

## Agent Usage Rules

### Always

Use `updateClip`. Keep duration at least `1`. Clear snap line and interaction state on pointer up.

### Never

Never mutate `clip` directly. Never change track on multi-drag when selected clips span multiple tracks.

### Common Mistakes

Using context `clips` for snapping when `sceneClips` was provided.

## Composition Patterns

Owned by `TrackRow`; selection state is global through timeline context.

## Styling Rules

Position with `left: clip.startFrame * zoom` and `width: clip.duration * zoom`.

## Performance Considerations

Drag/resize calls `updateClip` repeatedly; keep render content simple.

## Testing Guidance

Test click selection, modifier multi-select, drag snapping, resize from both ends, track movement, and graph-linked note indicators.

## Common Modification Tasks

To change drag behavior, update snap frame collection and track movement together.

## Related Components

`TrackRow`, `Preview`, `ClipPropertiesPanel`.

## Architecture Notes

Vertical track changes use visible child track order; collapsed groups remove destinations.

## AI Agent Summary

Purpose: Interactive timeline clip block.
Inputs: Clip plus optional scene overrides.
Outputs: Selection, drag, resize updates.
Dependencies: Timeline context and graph helpers.
Critical Rules: Minimum duration and snap cleanup.
Common Pitfalls: Breaking multi-scene snap/track calculations.
Safe Modifications: Adjust pointer logic with focused tests.

