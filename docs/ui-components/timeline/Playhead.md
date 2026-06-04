# Playhead

Source: `components/editor/Playhead.tsx`

## Purpose

Renders and optionally allows dragging the current-frame indicator.

## When To Use

Use in `TimelineRoot` header and content areas.

## When NOT To Use

Do not use without a scrollable container ref and timeline context.

## Visual Description

Red vertical line and/or diamond handle positioned at `currentFrame * zoom`.

## Dependencies

`useTimeline`, `cn`, React refs.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `containerRef` | `React.RefObject<HTMLDivElement \| null>` | yes | none | Container for pointer-to-frame math, including `scrollLeft`. |
| `mode` | `'all' \| 'handle' \| 'line'` | no | `'all'` | Renders handle, line, or both. |

## Internal State

No React state. Window pointer listeners are attached during drag.

## Data Flow

Reads `currentFrame` and `zoom`; writes `setCurrentFrame` on drag.

## Events

Pointer down on handle starts pointer move/up listeners. Move computes frame from container rect plus scroll offset.

## Accessibility

Pointer-only; add keyboard controls if it becomes a primary accessibility path.

## Usage Examples

### Minimal Example

```tsx
<Playhead containerRef={contentRef} />
```

### Typical Example

```tsx
<Playhead containerRef={headerRef} mode="handle" />
<Playhead containerRef={contentRef} mode="line" />
```

### Advanced Example

Generated: simulate pointer movement on the handle and assert `setCurrentFrame`.

### Real Project Example

`TimelineRoot` renders separate header and content playheads.

## Agent Usage Rules

### Always

Use the correct container ref. Include `scrollLeft` in frame math. Remove window listeners on pointer up.

### Never

Never position by seconds; use frames times `zoom`.

### Common Mistakes

Using the header ref for the content line or vice versa.

## Composition Patterns

Header playhead is the draggable handle; content playhead is the vertical line.

## Styling Rules

Line is pointer-events-none; handle is pointer-events-auto.

## Performance Considerations

Pointer move updates current frame rapidly; keep handler small.

## Testing Guidance

Test frame calculation with scrolled containers and mode-specific rendering.

## Common Modification Tasks

To add keyboard support, make handle focusable and add step controls.

## Related Components

`TimelineRoot`, `Ruler`, `Toolbar`.

## Architecture Notes

`mode="handle"` omits the line; `mode="line"` omits the handle.

## AI Agent Summary

Purpose: Current-frame indicator.
Inputs: Container ref, mode, timeline context.
Outputs: Current-frame updates.
Dependencies: `useTimeline`.
Critical Rules: Include container scroll offset.
Common Pitfalls: Ref/mode mismatch.
Safe Modifications: Add accessibility without changing frame math.

