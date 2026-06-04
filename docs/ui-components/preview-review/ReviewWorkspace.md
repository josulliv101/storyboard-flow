# ReviewWorkspace

Source: `components/editor/ReviewWorkspace.tsx`

## Purpose

Scroll-driven review view for notes and dialog, synchronized with preview playback and current timeline frame.

## When To Use

Use when `workspaceViewMode === "review"`.

## When NOT To Use

Do not use as the clip editing timeline.

## Visual Description

Top progress strip, per-lane markers, vertical time ruler, scrollable note/dialog cards, content-mode controls, preview integration, and vertical time scale controls.

## Dependencies

`Preview`, `useTimeline`, `Badge`, `Slider`, `Button`, dropdown menus, graph helpers, `scheduleReviewMomentExpansions`.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `onOpenScriptEditor` | `(clipId: string, sceneId: string) => void` | no | none | Opens script editor for a review item. |
| `showPreviewTagUi` | `boolean` | yes | none | Whether preview tag/graph UI is visible. |
| `setShowPreviewTagUi` | `(show: boolean) => void` | yes | none | Updates tag UI visibility. |
| `contentMode` | `'notes' \| 'dialog'` | no | `'notes'` | Chooses review card type. |
| `setContentMode` | `(mode: 'notes' \| 'dialog') => void` | yes | none | Updates content mode. |
| `verticalTimeScale` | `number` | no | `1` | Pixels-per-frame multiplier. |
| `setVerticalTimeScale` | `(scale: number) => void` | yes | none | Updates vertical scale. |

## Internal State

Review width/height, preview panel percent, visible note group keys, scroller refs, scroll sync flags, timeout refs, and animation frame refs.

## Data Flow

Builds lanes from preview scenes and enabled tracks. Notes are filtered by note tag filter and graph linkage. Scroll maps to current frame; current frame maps back to scroll when not user-scrolling or playing.

## Events

Scroll updates current frame. Wheel/pointer/touch while playing stops playback. Markers switch content mode and set current frame. Playback animates scroll with `requestAnimationFrame`.

## Accessibility

Timeline marker buttons include `aria-label`; time ruler has `aria-label="Timeline seconds"`.

## Usage Examples

### Minimal Example

```tsx
<ReviewWorkspace
  showPreviewTagUi
  setShowPreviewTagUi={setShowPreviewTagUi}
  setContentMode={setContentMode}
  setVerticalTimeScale={setVerticalTimeScale}
/>
```

### Typical Example

`EditorInner` passes review UI state and `openScriptEditorForClip`.

### Advanced Example

Generated: use `contentMode="dialog"` and multiple preview scenes to verify scene lanes.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Guard scroll/frame synchronization with refs to prevent loops. Preserve dense-note moment expansion. Keep filters aligned with `Preview`.

### Never

Never update current frame inside render calculations. Never remove cleanup for animation frames, timeouts, or observers.

### Common Mistakes

Breaking scene lanes in multi-scene review versus parent-group lanes in single-scene review.

## Composition Patterns

Renders `Preview` plus internal memoized `ReviewTimelineContent`.

## Styling Rules

Cards use stable dimensions and calculated columns. Preserve note card and marker constants unless updating layout tests.

## Performance Considerations

Lane positioning, moment expansions, and scroll sync are memoized/ref-driven.

## Testing Guidance

Existing stories cover dense note layout. Add tests for scroll-to-frame, playback scroll, marker merging, filters, and dialog mode.

## Common Modification Tasks

For a new review content type, extend `ReviewContentMode`, lane derivation, marker generation, controls, and card rendering.

## Related Components

`Preview`, `Editor`, `review-note-layout.ts`.

## Architecture Notes

Moment expansions add scroll height for simultaneous notes so dense clusters remain readable.

## AI Agent Summary

Purpose: Review-mode notes/dialog timeline.
Inputs: Review props plus timeline context.
Outputs: Current-frame updates and script editor callback.
Dependencies: `Preview`, graph helpers, review-note-layout.
Critical Rules: Guard scroll sync and cleanup observers/frames.
Common Pitfalls: Mixing multi-scene and single-scene lane rules.
Safe Modifications: Update lane derivation and layout stories together.

