# Ruler

Source: `components/editor/Ruler.tsx`

## Purpose

Renders horizontal timeline tick marks from `totalDuration`, `zoom`, and `fps`.

## When To Use

Use in `TimelineRoot` header above timeline content.

## When NOT To Use

Do not use for review mode's vertical ruler.

## Visual Description

Major second ticks with labels and smaller sub-second markers.

## Dependencies

`useTimeline`.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Reads `totalDuration`, `zoom`, and `fps` from context. |

## Internal State

None.

## Data Flow

Loops over frames and positions markers at `frame * zoom`.

## Events

None.

## Accessibility

Visual only; pointer events are disabled.

## Usage Examples

### Minimal Example

```tsx
<Ruler />
```

### Typical Example

`TimelineRoot` renders it inside the header scroll area.

### Advanced Example

Generated: seed `fps`, `zoom`, and `totalDuration`, then assert marker positions.

### Real Project Example

`components/editor/TimelineRoot.tsx`.

## Agent Usage Rules

### Always

Position by frames times `zoom`.

### Never

Never add timeline click logic here; `TimelineRoot` owns it.

### Common Mistakes

Confusing this with `ReviewWorkspace`'s vertical time ruler.

## Composition Patterns

Sibling to `Playhead` in the timeline header.

## Styling Rules

Keep small non-interactive labels.

## Performance Considerations

Marker count scales with duration; consider wider intervals for long timelines.

## Testing Guidance

Test tick count and positions for common fps values.

## Common Modification Tasks

To change tick density, update major/sub-marker loops.

## Related Components

`TimelineRoot`, `Playhead`.

## Architecture Notes

`majorInterval` and `minorInterval` are declared, but current loops use `fps` and `fps / 5`.

## AI Agent Summary

Purpose: Horizontal timeline tick ruler.
Inputs: Timeline context.
Outputs: Visual ticks.
Dependencies: `useTimeline`.
Critical Rules: Keep non-interactive.
Common Pitfalls: Adding timeline click behavior here.
Safe Modifications: Adjust marker intervals with tests.

