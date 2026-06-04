# CharactersPanel

Source: `components/editor/CharactersPanel.tsx`

## Purpose

Manages project characters: add, rename, delete, and image upload.

## When To Use

Use in the editor side panel when the characters tab is active.

## When NOT To Use

Do not use outside `TimelineProvider`.

## Visual Description

Side-panel list with "New Character" button, character cards, circular headshots, hover upload overlay, inline rename input, and edit/delete icon buttons.

## Dependencies

`useTimeline`, `Button`, `motion/react`, `cn`, lucide icons.

## Public API

| Prop | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| none | n/a | n/a | n/a | Uses character actions from context. |

## Internal State

`editingId` and `editName`.

## Data Flow

Calls `addCharacter`, `updateCharacter`, and `deleteCharacter`. Image upload passes selected file to `updateCharacter(id, {}, file)`.

## Events

Add creates `Character ${characters.length + 1}`. Edit opens inline input. Enter/save commits rename. Upload updates image. Delete removes character and context clears clip references.

## Accessibility

Uses native buttons and file inputs. Preserve focusable/visible affordances if changing upload overlay.

## Usage Examples

### Minimal Example

```tsx
<CharactersPanel />
```

### Typical Example

Rendered by `EditorInner` in the characters sidebar tab.

### Advanced Example

Generated: seed characters and verify upload calls `updateCharacter`.

### Real Project Example

`components/editor/Editor.tsx`.

## Agent Usage Rules

### Always

Use context actions. Keep rename state local. Pass image files through context.

### Never

Never edit the `characters` array locally. Context handles clip cleanup on delete.

### Common Mistakes

Forgetting character deletion must unset matching clip `characterId`; use context.

## Composition Patterns

Simple side-panel child of `Editor`.

## Styling Rules

Keep card list compact and side-panel friendly.

## Performance Considerations

Character count is small; no special memoization needed.

## Testing Guidance

Test add, rename, cancel, upload, and delete cleanup.

## Common Modification Tasks

For new character fields, update `Character`, panel UI, `ClipItem`, `Preview`, serialization, and context update logic.

## Related Components

`ClipItem`, `Preview`, `ScriptClipEditorModal`, `ClipPropertiesPanel`.

## Architecture Notes

Character images may be runtime object URLs after hydration; export logic strips runtime URLs.

## AI Agent Summary

Purpose: Character side panel.
Inputs: Timeline context.
Outputs: Character CRUD.
Dependencies: `Button`, motion, timeline context.
Critical Rules: Use context actions for cleanup.
Common Pitfalls: Handling image persistence locally.
Safe Modifications: Extend character fields across context, panel, preview, and serialization.

