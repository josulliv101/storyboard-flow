# Punch List 03

## PL3-001 — Limit breadcrumb inline editing to the current item

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec/timeline-mrupwdw45u6lld
- Area: Graph header — timeline breadcrumb
- Screenshot: Not captured

Keep inline editing for the last breadcrumb item, which represents the
currently open timeline. Every earlier breadcrumb item should instead be a
navigation link that opens the corresponding ancestor timeline view.

Acceptance criteria:

- Only the last breadcrumb item can enter inline-edit mode.
- The last item retains its current single-click edit behavior.
- Pressing Enter or moving focus outside the editor commits the last item's
  updated name.
- Every earlier breadcrumb item renders as a link rather than an inline-edit
  control.
- Selecting an earlier breadcrumb item navigates to that item's correct
  timeline view.
- Each ancestor link uses the correct path depth and preserves encoded
  timeline identifiers.
- Ancestor links retain clear hover and keyboard-focus feedback.
- Clicking an ancestor never opens the rename editor or renames that item.

## PL3-002 — Match the selected-action separator to the selection border

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec/timeline-mrupwdw45u6lld
- Area: Sidebar icon bar — selected-item action context
- Screenshot: Not captured

When an item is selected, the context-aware sidebar includes a separator
directly above the bottom close or Done action. Change this separator from its
current neutral color to the same subdued yellow or amber used for the selected
item's border.

Acceptance criteria:

- The separator above the close or Done icon uses the same color as the
  selected item's border.
- The separator remains visually subdued and does not appear brighter or more
  saturated than the selection border.
- The matching color reinforces the relationship between the selected item
  and its context-aware actions.
- The separator's size, position, spacing, and behavior remain unchanged.
- The separator remains legible against the sidebar background without
  competing with the action icons.

## PL3-003 — Subdue the active “Drop to nest” background veil

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec
- Area: Collection item — nested-drop feedback
- Screenshot: Not captured

When a dragged item is held over a collection, the active “Drop to nest”
treatment currently uses a bright, translucent whitish blur over the
collection content. Replace that bright veil with a more subdued,
semi-transparent gray treatment.

Acceptance criteria:

- The active nesting veil uses a muted gray rather than a bright white tint.
- The gray treatment remains translucent so the underlying collection is
  still recognizable.
- The veil continues to suppress the underlying preview, name, and metadata
  enough for the “Drop to nest” label to remain easy to read.
- The label's size, bottom-center position, and contrast remain unchanged.
- The background blur may remain, but it should no longer create a bright or
  washed-out appearance.
- Valid nesting feedback remains clearly distinguishable from the invalid or
  cycle-prevention state.

## PL3-004 — Enlarge and inset image/video type labels

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec
- Area: Grid items — image and video type labels
- Screenshot: Not captured

Image and video items display a small type label in the lower-left corner.
Make this label slightly larger and give it more breathing room from the
item's left and bottom edges.

Acceptance criteria:

- Both IMAGE and VIDEO labels use a slightly larger, more readable type size.
- The label is inset farther from the item's left edge.
- The label is inset farther from the item's bottom edge.
- Internal label padding remains balanced around the text.
- The updated label stays compact and does not obscure important preview
  content.
- The treatment remains consistent across supported grid item sizes and
  selected, disabled, hover, and drag states.

## PL3-005 — Use the collection folder glyph for empty drag previews

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — drag preview
- Screenshot: Not captured

An empty collection has no preview images to display in its drag element.
When such a collection is dragged, show the same folder-with-right-pointing
arrow glyph currently used in the center of collection items as the drag
preview's primary visual.

Acceptance criteria:

- Dragging an empty collection displays the folder-with-right-pointing-arrow
  glyph instead of an empty or missing image area.
- The drag preview reuses the existing collection-item glyph rather than
  introducing a visually different icon.
- The glyph is centered and sized clearly within the drag preview.
- The collection name and any other existing drag-preview information remain
  available where applicable.
- Non-empty collections continue to use their existing image-based drag
  previews.
- The empty-collection preview remains recognizable across supported item
  sizes and while crossing different drop targets.

## PL3-006 — Remove unnecessary outer padding from grid and strip views

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph board — grid and strip surface containers
- Screenshot: Not captured

Both the grid view and strip view have unnecessary padding around the outside
of their item surfaces. Remove that extra spacing on all four sides so the
views use the available board area more efficiently.

Acceptance criteria:

- The unnecessary top, right, bottom, and left outer padding is removed from
  the grid view.
- The same unnecessary outer padding is removed from the strip view.
- Item-to-item gaps and intentional spacing inside each surface remain
  consistent.
- Cards, drop indicators, drag targets, and selection borders are not clipped
  at the surface edges.
- Empty states, scrollbars, and time-ruler alignment remain correctly
  positioned after the padding change.
- The result remains consistent across supported viewport widths and item
  sizes.

## PL3-007 — Reduce the collection folder-arrow icon stroke weight

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — center open-folder icon
- Screenshot: Not captured

The folder-with-right-pointing-arrow icon shown on collection items currently
has a stroke that appears too heavy. Reduce its stroke weight so the glyph
looks lighter and better balanced with the surrounding card UI.

Acceptance criteria:

- The collection folder-arrow icon uses a visibly lighter stroke weight.
- The folder and arrow remain clearly recognizable at every supported item
  size.
- The icon remains legible over both preview imagery and empty collection
  backgrounds.
- Its dimensions, center position, hit area, and open-collection behavior
  remain unchanged.
- Any reuse of this glyph in the empty-collection drag preview follows the
  same lighter visual treatment.

## PL3-008 — Replace Copy and Cut with Paste while the clipboard is armed

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec
- Area: Sidebar icon bar — selected-item action context
- Screenshot: Not captured

When an item is selected, Copy and Cut are initially available. After either
operation places content on the graph clipboard and makes Paste visible, hide
both Copy and Cut. Restore them after the paste completes or the clipboard is
cleared.

Acceptance criteria:

- Copy and Cut are visible while an item is selected and the graph clipboard
  is empty.
- Completing Copy or Cut makes Paste visible immediately.
- Whenever Paste is visible because clipboard content is available, Copy and
  Cut are hidden.
- After a successful paste consumes or clears the clipboard, Paste hides and
  Copy and Cut return when a selection is available.
- Explicitly clearing or canceling the clipboard produces the same reset.
- The transition does not require a page reload or reselection.
- Remaining actions preserve a clear and intentional order without empty
  spacing where Copy and Cut were removed.
- Keyboard copy, cut, paste, and cancel behavior remains consistent with the
  visible sidebar state.

## PL3-009 — Keep the Disabled status label fully visible

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid and strip items — disabled state
- Screenshot: Not captured

Disabled items correctly mute and gray out their background content, but the
Disabled label in the upper-right is currently affected by the same opacity
and grayscale treatment. Keep the label at normal opacity and color so it
remains clear and noticeable.

Acceptance criteria:

- The underlying content of a disabled item retains its existing muted,
  grayscale appearance.
- The Disabled label is excluded from the item's opacity and grayscale
  treatment.
- The label renders at full opacity with a clear, intentional color and
  readable contrast.
- The label remains positioned in the item's upper-right corner.
- The label stays noticeable across image, video, and collection items in both
  grid and strip views.
- Selected, inherited-disabled, hover, and drag states do not unintentionally
  dim or obscure the status label.

## PL3-010 — Preserve the full selection border on disabled items

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec
- Area: Grid and strip items — disabled selection state
- Screenshot: Not captured

When a disabled item is selected, its highlight border currently becomes
muted or faded along with the disabled content. The selection border should
look exactly the same as it does around an enabled selected item.

Acceptance criteria:

- A selected disabled item uses the same border color as a selected enabled
  item.
- Border opacity, saturation, thickness, and visibility are identical in both
  states.
- The disabled item's background content remains muted while the selection
  border stays unaffected.
- The behavior is consistent for image, video, and collection items.
- The matching selection treatment works in both grid and strip views.
- Hover, focus, drag, error, and inherited-disabled states do not weaken or
  obscure the active selection border.

## PL3-011 — Keep disabled collection metadata at normal visibility

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm7d1jocgec
- Area: Collection items — disabled state metadata
- Screenshot: Not captured

When a collection item is disabled, its preview content may remain muted, but
the collection name, duration, and item count should retain their normal
appearance rather than becoming faded or grayscale.

Acceptance criteria:

- A disabled collection's name uses the same opacity and color treatment as
  an enabled collection's name.
- The duration remains fully visible and preserves its normal color.
- The item count and singular or plural label remain fully visible and
  preserve their normal color.
- The slash separating duration and item count remains clearly visible.
- Preview imagery or other background content may retain the existing muted
  disabled treatment.
- The metadata remains unaffected by direct and inherited disabled states.
- Selected, hover, focus, and drag states do not reduce the metadata's normal
  readability.
- The behavior remains consistent in grid and strip views at all supported
  item sizes.
