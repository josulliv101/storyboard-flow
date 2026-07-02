# UI Package Rules

This package must stay framework-agnostic.

Do not import:

- `next/link`
- `next/image`
- Next.js router hooks
- server actions
- app-specific modules

When changing UI components, update Storybook coverage in the Storybook app or existing story location.

For timeline/media components, include stories for selected state, trim handles, missing poster fallback, repeated thumbnails, short clips, long clips, and many-item timelines.

## React component guidance

When building or modifying React components, prefer composition over large configurable components.

Use small focused components that can be combined together rather than one component with many boolean props, mode props, or deeply nested conditionals.

Prefer patterns like:

* `children` for custom content
* compound components when pieces are tightly related
* render props only when needed
* small wrapper components for app-specific behavior
* shared hooks for reusable logic
* slot-style props for replacing sections of UI

Avoid adding props like `isCompact`, `showHeader`, `showFooter`, `variantMode`, `enableX`, or `type="advanced"` when the same result can be achieved by composing smaller parts.

Good:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Project</CardTitle>
    <CardActions>
      <Button>Edit</Button>
    </CardActions>
  </CardHeader>

  <CardBody>
    <ProjectSummary project={project} />
  </CardBody>
</Card>
```

Avoid:

```tsx
<Card
  title="Project"
  showActions
  actionLabel="Edit"
  showSummary
  compact={false}
  variant="project"
/>
```

When changing existing components, split responsibilities before adding more props. Keep components easy to read, test, and reuse.

