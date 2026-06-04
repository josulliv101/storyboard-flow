# ResponsiveAspectFrame

Source: `components/editor/ResponsiveAspectFrame.tsx`

## Purpose

Fits an inner frame inside a measured container while preserving a supported aspect ratio.

## When To Use

Use for preview frames, Storybook layout contracts, and fixed-aspect editor surfaces.

## When NOT To Use

Do not use for arbitrary content that should simply fill available space.

## Visual Description

Outer cell measures itself; inner frame receives calculated width/height and caller classes/styles.

## Dependencies

React, `ResizeObserver` with resize fallback, CSS `containerType: "size"`.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `aspectRatio` | `string` | yes | none | Supports `16:9`, `4:3`, `21:9`; otherwise falls back to `16:9`. |
| `cellClassName` | `string` | yes | none | Outer cell class. |
| `cellTestId` | `string` | no | none | Test id on cell. |
| `children` | `React.ReactNode` | yes | none | Frame contents. |
| `frameClassName` | `string` | yes | none | Inner frame class. |
| `frameDataAttributes` | `Record<\`data-${string}\`, string \| number \| boolean \| undefined>` | no | none | Data attributes for frame. |
| `frameStyle` | `CSSProperties` | no | none | Extra frame style. |
| `frameTestId` | `string` | no | none | Test id on frame. |

## Internal State

Measured element width/height from `useElementSize`.

## Data Flow

Measurement plus ratio factor determines inner frame dimensions.

## Events

Responds to `ResizeObserver` updates or window resize fallback.

## Accessibility

No semantics; caller owns roles and labels.

## Usage Examples

### Minimal Example

```tsx
<ResponsiveAspectFrame
  aspectRatio="16:9"
  cellClassName="flex h-full w-full items-center justify-center"
  frameClassName="relative overflow-hidden bg-black"
>
  {children}
</ResponsiveAspectFrame>
```

### Typical Example

Used by `Preview`.

### Advanced Example

Generated: pass `frameDataAttributes={{ "data-preview-id": id }}` for layout tests.

### Real Project Example

`DialogPreviewLayout.stories.tsx`.

## Agent Usage Rules

### Always

Pass stable cell/frame classes. Use supported aspect keys or expect fallback.

### Never

Never rely on it for accessibility semantics. Never remove observer cleanup.

### Common Mistakes

Passing unsupported custom ratios and expecting them to work.

## Composition Patterns

Utility component used under preview and layout contract stories.

## Styling Rules

`frameStyle` is merged after computed sizing styles.

## Performance Considerations

Updates only on container resize.

## Testing Guidance

Test supported ratios, fallback, and resizing.

## Common Modification Tasks

To add a ratio, update `aspectRatioOptions` and any UI that exposes ratios.

## Related Components

`Preview`.

## Architecture Notes

Fallback is `16:9`.

## AI Agent Summary

Purpose: Responsive fixed-aspect frame.
Inputs: Aspect key, classes, children, optional attrs/styles/test IDs.
Outputs: Sized inner frame.
Dependencies: `ResizeObserver`.
Critical Rules: Caller owns semantics/classes.
Common Pitfalls: Unsupported ratio fallback.
Safe Modifications: Add ratios centrally.

