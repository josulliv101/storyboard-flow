# UI Component Documentation

AI-agent-friendly documentation for the editor UI. Load only the component file you need, then inspect the linked source if changing behavior.

## Editor Shell

- [Editor](./editor/Editor.md) ([agent profile](./editor/Editor.agent.yaml))
- [Toolbar](./editor/Toolbar.md) ([agent profile](./editor/Toolbar.agent.yaml))

## Timeline

- [TimelineRoot](./timeline/TimelineRoot.md) ([agent profile](./timeline/TimelineRoot.agent.yaml))
- [TrackRow](./timeline/TrackRow.md) ([agent profile](./timeline/TrackRow.agent.yaml))
- [ClipItem](./timeline/ClipItem.md) ([agent profile](./timeline/ClipItem.agent.yaml))
- [Ruler](./timeline/Ruler.md) ([agent profile](./timeline/Ruler.agent.yaml))
- [Playhead](./timeline/Playhead.md) ([agent profile](./timeline/Playhead.agent.yaml))

## Preview And Review

- [Preview](./preview-review/Preview.md) ([agent profile](./preview-review/Preview.agent.yaml))
- [ReviewWorkspace](./preview-review/ReviewWorkspace.md) ([agent profile](./preview-review/ReviewWorkspace.agent.yaml))
- [ResponsiveAspectFrame](./preview-review/ResponsiveAspectFrame.md) ([agent profile](./preview-review/ResponsiveAspectFrame.agent.yaml))

## Panels And Modals

- [CharactersPanel](./panels-modals/CharactersPanel.md) ([agent profile](./panels-modals/CharactersPanel.agent.yaml))
- [ScriptClipEditorModal](./panels-modals/ScriptClipEditorModal.md) ([agent profile](./panels-modals/ScriptClipEditorModal.agent.yaml))

## Agent Profile Format

Each `.agent.yaml` file follows the updated `components/component-agent-profile` skill shape: purpose, inputs, outputs, dependencies, always/never rules, accessibility, performance, common mistakes, related components, extension points, and a short agent summary.

## Shared Primitives

Shared shadcn/Base UI wrappers live in `components/ui`: `button`, `badge`, `card`, `dropdown-menu`, `slider`, `tooltip`, `alert-dialog`, `tabs`, `scroll-area`, `separator`, and `sonner`.
