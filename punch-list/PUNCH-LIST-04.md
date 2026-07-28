# Punch List 04

## PL4-001 — Make grid and strip surfaces flush with the breadcrumb row

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph board — grid and strip surface layout
- Screenshot: Not captured

The grid and strip currently appear nested inside an additional content
container, one visual level deeper than the breadcrumb row. Remove that nested
panel treatment so both item surfaces align with and span the same full width
as the breadcrumb row. As part of the same cleanup, reduce the vertical space
between the breadcrumb row and the item surface below it to a small,
intentional gap.

Acceptance criteria:

- Grid items extend flush to the same left and right boundaries as the
  breadcrumb row.
- Strip items extend flush to the same left and right boundaries as the
  breadcrumb row.
- No extra horizontal or vertical padding surrounds either item surface.
- The grid does not render an outer border, dashed outline, rounded panel
  frame, or other container chrome around its items.
- The strip does not render an outer border, dashed outline, rounded panel
  frame, or other container chrome around its items.
- The grid and strip no longer read as a nested content area.
- The vertical gap between the breadcrumb row and the grid is small and
  visually intentional.
- The vertical gap between the breadcrumb row and the strip is the same small
  amount.
- Switching between grid and strip does not change that breadcrumb-to-content
  spacing.
- Intentional spacing between individual items remains unchanged.
- Selection rings, drag targets, drop indicators, empty states, rulers,
  scrollbars, and playhead controls are not clipped by the full-width layout.
- The alignment remains consistent across supported viewport widths and
  while switching between grid and strip modes.

## PL4-002 — Move the settings icon to the board size menu

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph board toolbar and sidebar icon bar
- Screenshot: Not captured

Replace the vertical-three-dots icon next to Undo and Redo in the main graph
toolbar with a settings icon. This control should keep opening the same menu
and retain its current size-selection behavior. Remove the separate settings
icon from the bottom of the sidebar because it is redundant.

Acceptance criteria:

- The control next to Undo and Redo uses a recognizable settings icon instead
  of the vertical-three-dots icon.
- Its position, hit area, tooltip, enabled state, and keyboard accessibility
  remain intact.
- Clicking the new settings icon opens the same menu that the
  vertical-three-dots control previously opened.
- All existing grid and strip size options remain available and continue to
  work.
- The settings icon at the bottom of the sidebar is removed.
- Removing the sidebar control leaves no empty slot, divider, or excess gap.
- Assets, Trash, Account, and the other sidebar controls retain their current
  order and spacing.
- There is only one settings icon in this graph-page context.

## PL4-003 — Show only the folder glyph in an empty collection drag preview

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — empty drag preview
- Screenshot: Not captured

When a collection containing no items is dragged, its drag preview should show
only the folder-with-right-arrow glyph. Remove the collection name, caption,
placeholder, or other light-colored content currently appearing beneath the
glyph.

Acceptance criteria:

- An empty collection drag preview contains only the folder-with-right-arrow
  glyph.
- No collection name, “Timeline” caption, placeholder text, white strip, or
  other content appears beneath the glyph.
- The glyph remains centered horizontally and vertically within the drag
  preview.
- The glyph retains the same lighter stroke treatment used on collection
  cards.
- The drag preview remains clearly visible over both light and dark content.
- Non-empty collections continue to use their image-based drag previews.
- Multi-item drag count badges continue to appear when applicable without
  introducing other content into the empty-collection preview.

## PL4-004 — Constrain and pad breadcrumb destination hints during drag

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-ms3dcxh3uufsc9/timeline-ms3jkgcpvk8gis
- Area: Graph header — drag destination and trash drop target
- Screenshot: Not captured

While an item is dragged, the top-right header area normally becomes the trash
drop target. Hovering an ancestor breadcrumb changes that area into a
destination hint naming the breadcrumb collection. Long destination names
currently grow too wide, and the name does not have the balanced left and
right padding used by the trash label.

Acceptance criteria:

- The breadcrumb destination name has a defined maximum width.
- Names that exceed the available width truncate with an ellipsis rather than
  expanding or overflowing the drop target.
- The destination name has balanced left and right padding.
- Its horizontal padding visually matches the trash drop-area label.
- Short breadcrumb names remain centered and are not unnecessarily truncated.
- The drop target keeps a stable height and does not shift surrounding header
  controls when switching between Trash and breadcrumb-destination states.
- The full breadcrumb destination remains available through an accessible
  name, tooltip, or equivalent non-visual text.
- Trash and breadcrumb destination states remain visually distinct and retain
  their existing drop behavior.

## PL4-005 — Prevent long breadcrumbs from overlapping the timeline summary

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-ms3dcxh3uufsc9/timeline-ms3jkgcpvk8gis
- Area: Graph header — breadcrumb and clip-count/duration summary
- Screenshot: [Current breadcrumb overlap](screenshots/PL4-005-breadcrumb-overlap.png)

A long breadcrumb trail can expand into the centered clip-count and duration
summary. The breadcrumb must yield to the other header content, use only the
space available to it, and truncate long names before either area overlaps.

Acceptance criteria:

- The breadcrumb trail never overlaps the clip-count and duration summary.
- The clip-count and duration summary remains fully visible and readable.
- The breadcrumb region is constrained to the space remaining beside the
  summary and toolbar controls.
- Long breadcrumb names truncate with an ellipsis before reaching the summary.
- Truncation favors preserving the current timeline name while still keeping
  the overall trail within its available width.
- Breadcrumb separators remain visible and correctly spaced where practical.
- Ancestor links and the current editable crumb retain their existing
  navigation and rename behavior.
- The full name of every truncated crumb remains available through a tooltip,
  accessible name, or equivalent non-visual text.
- Entering inline-edit mode does not cause the editor to overlap the summary.
- The layout remains collision-free at supported desktop widths and while
  resizing the browser.

## PL4-006 — Standardize and shorten sidebar separators

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — normal and selected-item contexts
- Screenshot: Not captured

The normal sidebar and the context-aware sidebar shown for selected items both
contain horizontal separators. Make those separators exactly the same length,
and reduce that shared length because both currently appear too wide.

Acceptance criteria:

- The normal sidebar separator and selected-item context separator use the
  same width.
- Both separators are visibly shorter than their current width.
- A single shared size or styling rule controls their width so the two modes
  cannot drift apart.
- Each separator remains horizontally centered in the sidebar.
- Existing separator colors remain appropriate to their context, including
  the amber relationship to a selected item where applicable.
- Separator thickness, vertical spacing, and surrounding action order remain
  unchanged unless a minor adjustment is needed to preserve centering.
- Switching between normal and selected-item sidebar modes does not produce a
  horizontal size jump.

## PL4-007 — Remove the yellow border from the Disabled label

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrw5phknx4l9cc
- Area: Grid and strip items — disabled status label
- Screenshot: Not captured

The Disabled label in the upper-right corner of a disabled item currently has
a yellow border. Remove that yellow outline so the status label does not
compete with or resemble the selected-item border.

Acceptance criteria:

- The Disabled label no longer renders a yellow border, ring, or outline.
- The label remains fully opaque and clearly readable.
- Its background and text retain sufficient contrast over image, video, and
  collection previews.
- The label remains in the upper-right corner with its existing size and
  padding.
- The selected-item border remains unchanged and visually distinct from the
  Disabled label.
- Directly disabled and inherited-disabled states use intentional,
  non-selection border treatments.
- The result remains consistent in grid and strip views, including selected,
  hover, focus, and drag states.

## PL4-008 — Center every blue insertion indicator in its item gap

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid and strip drag-and-drop — insertion position indicator
- Screenshot: Not captured

The blue vertical insertion bar that previews a dragged item's drop position
is not always centered in the gap between adjacent items. Use one consistent
positioning calculation so the bar's center aligns exactly with the geometric
center of the gap.

Acceptance criteria:

- The center of the blue insertion bar matches the exact center of the
  adjacent-item gap.
- The indicator never uses alternate left-offset, center, or right-offset
  positions for the same insertion boundary.
- Centering is based on the rendered item rectangles and actual gap, including
  the indicator's own width.
- The behavior is consistent between grid and strip views.
- First-item, last-item, row-start, row-end, and full-last-row insertion
  positions use the same centering rule where a gap exists.
- Different card sizes, responsive grid columns, zoom levels, and strip
  duration widths do not introduce an offset.
- Scrolling, virtualization, and drag auto-scroll do not change the
  indicator's horizontal alignment.
- The displayed insertion position continues to match the committed drop
  order.

## PL4-009 — Make the breadcrumb destination message look like a hint

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrqmm4xxyqc9p6
- Area: Graph header — breadcrumb drag destination feedback
- Screenshot: Not captured

When a dragged item hovers over an ancestor breadcrumb, the right side of the
header displays text naming the destination. Its current styling resembles a
separate drop target even though the breadcrumb itself is the active target.
Restyle that message as passive, explanatory help text. Do not change the
trash drop area shown during drag.

Acceptance criteria:

- The breadcrumb destination message reads visually as a hint or status
  message rather than an interactive drop zone.
- It does not use the border, dashed outline, filled target surface, or other
  affordances that make the trash area read as droppable.
- The text clearly communicates which breadcrumb destination will receive the
  item.
- The hint remains legible, compact, and visually subordinate to the actual
  breadcrumb drop target.
- The truncation and horizontal-padding requirements from PL4-004 continue to
  apply.
- The trash drop area retains its existing appearance, dimensions, hover
  feedback, and drop behavior.
- Switching between trash-target and breadcrumb-hint states does not shift
  surrounding header controls.
- The breadcrumb remains the only interactive drop target for this move and
  retains its existing drop behavior.

## PL4-010 — Use 16:9 cards in the initial grid and strip skeleton

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph page — initial loading skeleton
- Screenshot: Not captured

Before the main graph content becomes visible, the loading skeleton represents
the upcoming grid or strip items. Those placeholder cards are currently too
tall. Render them at a 16:9 aspect ratio so the loading state better reflects
the final media-card proportions.

Acceptance criteria:

- Grid skeleton item placeholders use a 16:9 width-to-height ratio.
- Strip skeleton item placeholders use the same 16:9 ratio.
- Placeholder heights are visibly reduced from the current loading state.
- Skeleton widths continue to respond appropriately to the available
  viewport and selected surface layout.
- The skeleton preserves the expected number, spacing, and general placement
  of upcoming items.
- The transition from skeleton to loaded content minimizes vertical layout
  shift.
- Rounded corners, shimmer or pulse treatment, and existing loading
  accessibility behavior remain intact.
- The 16:9 treatment remains consistent across supported desktop widths.
