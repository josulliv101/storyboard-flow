# ScriptClipEditorModal

Source: `components/editor/Editor.tsx`

## Purpose

Bulk text editor for all visible dialog clips or note clips of the selected type, with filtering, tag editing, graph linking for notes, and save-to-clips behavior.

## When To Use

Use from `EditorInner` when selected clip is `dialog` or `note`.

## When NOT To Use

Do not use for media clips or generic text editing.

## Visual Description

Centered dark modal with filter controls, large textarea, tag/graph controls, and save/cancel actions.

## Dependencies

`TimelineClip`, tracks/characters from context, `Button`, `motion/react`, graph helpers, parser/formatter helpers in `Editor.tsx`.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| `selectedClip` | `TimelineClip` | yes | none | Dialog/note clip used for type, track, metadata, and focus. |
| `clips` | `TimelineClip[]` | yes | none | Source clips for same-type bulk editor. |
| `tracks` | `ReturnType<typeof useTimeline>['tracks']` | yes | none | Tracks for selected track and graph options. |
| `characters` | `ReturnType<typeof useTimeline>['characters']` | yes | none | Character lookup for dialog speaker matching. |
| `fps` | `number` | yes | none | Converts seconds to frames. |
| `updateClip` | `(id: string, updates: Partial<TimelineClip>) => void` | yes | none | Applies parsed updates. |
| `addClip` | `(clip: TimelineClip, file?: File) => void` | yes | none | Adds extra parsed blocks. |
| `onClose` | `() => void` | yes | none | Closes modal. |

## Internal State

Active filter, text, tags, linked graph IDs, tag draft, focused block index, textarea scroll, and refs.

## Data Flow

Formats clips as `[startSeconds, durationSeconds] Heading` blocks. On save, parses blocks into frame/duration/name/body/character/tag/graph updates. Existing visible clips update by index; extra blocks create clips.

## Events

Backdrop closes. Textarea focus updates focused block. Filter changes rebuild text. Save parses and applies changes.

## Accessibility

Uses textarea and buttons but is a custom modal. Preserve focus behavior; consider dialog roles if hardening accessibility.

## Usage Examples

### Minimal Example

```tsx
<ScriptClipEditorModal
  selectedClip={clip}
  clips={clips}
  tracks={tracks}
  characters={characters}
  fps={fps}
  updateClip={updateClip}
  addClip={addClip}
  onClose={close}
/>
```

### Typical Example

Rendered by `EditorInner` inside `AnimatePresence` for dialog/note clips.

### Advanced Example

Generated: pass a note clip with sibling graph tracks to show graph link controls.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Keep formatter and parser in sync. Match character names case-insensitively. Convert seconds to frames with `fps`.

### Never

Never apply text edits to clips outside the visible filtered set. Never use for non-dialog/non-note clips.

### Common Mistakes

Assuming tags apply to every note in a filtered edit; current save behavior primarily applies tag/link updates to the selected note unless creating new notes.

## Composition Patterns

Owned by `EditorInner`; receives context actions as props instead of calling `useTimeline` itself.

## Styling Rules

Keep modal bounded by viewport: `h-[min(760px,88vh)]`, `w-[min(980px,94vw)]`.

## Performance Considerations

Large clip sets can make textarea updates heavier; keep filter operations memoized.

## Testing Guidance

Existing story covers offscreen selected note focus. Add parser tests for invalid headings, extra blocks, tag filters, graph links, and dialog character matching.

## Common Modification Tasks

To change script syntax, update formatter, parser, caret logic, examples, and stories.

## Related Components

`Editor`, `ClipPropertiesPanel`, `ReviewWorkspace`, `CharactersPanel`.

## Architecture Notes

Edits are applied by sorted visible clip order, not IDs embedded in text.

## AI Agent Summary

Purpose: Bulk dialog/note text editor.
Inputs: Selected clip, clips, tracks, characters, fps, callbacks.
Outputs: Updates/adds dialog or note clips.
Dependencies: Parser/formatter helpers and graph/character lookups.
Critical Rules: Keep parser/formatter aligned and scope saves to visible filtered clips.
Common Pitfalls: Applying note metadata too broadly.
Safe Modifications: Change syntax with parser/story tests.

