# Punch List

## PL-001 — Hide the Trash icon on the Timeline Projects page

- Status: Completed
- URL: http://localhost:3000/
- Area: Timeline Projects — side icon bar
- Screenshot: Not captured

The side icon bar should not display the Trash icon on the Timeline Projects
page. The Trash icon should remain visible on other regular application pages.

Acceptance criteria:

- The side icon bar omits the Trash icon on the Timeline Projects page.
- The Trash icon remains available in the side icon bar on other regular pages.

## PL-002 — Show immediate feedback while opening a project

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Project selection and timeline-page navigation
- Screenshot: Not captured

Selecting a project currently has a noticeable delay with no indication that
navigation or loading is in progress. The application should transition to the
selected project's page immediately and display skeleton placeholders there
until the real page content is ready.

Acceptance criteria:

- Selecting a project produces immediate visual feedback.
- The application transitions to the selected project's destination page
  without leaving the projects page looking unresponsive.
- The destination page displays skeletons that represent its loading layout.
- The skeletons are replaced by the real project content when loading
  completes.

## PL-003 — Correct collection drag-and-drop feedback in grid view

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid view — dragging a new collection
- Screenshot: Not captured

Dragging a new collection onto the grid sometimes shows the browser's
“no drop” cursor even though the grid is a valid drop target. A vertical yellow
insertion line also appears at the bottom of the grid instead of at the
collection's actual intended insertion point. The visual indicator and the
resulting drop location are not aligned.

Acceptance criteria:

- A valid new-collection drag over the grid never displays the “no drop”
  cursor.
- The yellow insertion indicator appears at the location represented by the
  current pointer position.
- Dropping the collection inserts it at the location shown by the indicator.
- The indicator updates as the pointer moves and disappears when the drag ends
  or leaves the valid drop area.

## PL-004 — Remove the legacy Storyboard View menu item

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Vertical three-dot overflow menu
- Screenshot: Not captured

The overflow menu currently includes a legacy item labeled “Storyboard View.”
This obsolete link should no longer appear in the menu.

Acceptance criteria:

- “Storyboard View” is removed from the vertical three-dot overflow menu.
- The remaining menu items continue to appear and function normally.

## PL-005 — Center the grid-item drop indicator within the gap

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid view — reordering items
- Screenshot: Not captured

While a grid item is being dragged, the blue vertical insertion line appears
inside the gap between two items. Its horizontal position is inconsistent: it
can appear at the left edge, center, or right edge of the same gap. The line
should always be centered within the gap.

Acceptance criteria:

- The blue insertion line is horizontally centered in the gap between the two
  items surrounding the proposed drop position.
- The line does not shift between left-, center-, and right-aligned variants
  for the same gap.
- The centered indicator remains aligned with the actual resulting insertion
  position.

## PL-006 — Improve collection labels and metadata readability

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item UI
- Screenshot: Not captured

Collection items display their duration and item count, but the count is shown
as an unlabeled number, such as “2,” which does not clearly communicate what it
represents. The metadata is also too small, and the collection name needs
greater visual prominence and readability.

Acceptance criteria:

- The collection count includes a clear label, such as “2 items.”
- Singular and plural labels are grammatically correct, such as “1 item” and
  “2 items.”
- The duration and item-count text is larger and easier to read.
- The collection name is larger and easier to read.
- The updated typography preserves a clear hierarchy between the collection
  name and its supporting metadata.

## PL-007 — Move the “Drop to Nest” label below the drag preview

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — nested-drop feedback
- Screenshot: Not captured

When an item is dragged over a collection, the “Drop to Nest” label appears in
the center of the collection item. The dragged element usually occupies that
same area and obscures the label. Position the label at the bottom center of
the collection item instead.

Acceptance criteria:

- The “Drop to Nest” label is horizontally centered near the bottom of the
  collection item.
- The label remains visible and readable while the dragged element is over the
  collection.
- The label does not cover important collection content or interfere with the
  drop target.

## PL-008 — Improve the sidebar Trash-area icon

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — Trash area
- Screenshot: Not captured

The current Trash-area icon combines a folder with a small trash symbol, but
the trash symbol is difficult to recognize at sidebar size. Replace it with a
clearer visual representation of the Trash area while keeping it distinct from
the standard trash-bucket icon used for other actions.

Acceptance criteria:

- The icon clearly communicates that it opens the Trash area at its rendered
  sidebar size.
- The visual remains distinguishable from the regular trash-bucket action
  icon used elsewhere.
- The icon is legible and recognizable in the sidebar's default, hover,
  focused, and active states.

## PL-009 — Add an overflow menu to selected-item sidebar actions

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — selected-item action context
- Screenshot: Not captured

The contextual sidebar action list shown when an item is selected is becoming
too long. Add a vertical three-dot overflow icon above the separator and move
the less-frequent Duplicate and Disable actions into its menu.

Acceptance criteria:

- A vertical three-dot overflow button appears above the separator in the
  selected-item sidebar context.
- Activating the overflow button opens a menu containing Duplicate and
  Disable.
- Duplicate and Disable are removed from the primary sidebar icon list.
- Both actions retain their existing behavior when invoked from the overflow
  menu.
- The remaining selected-item actions preserve their current ordering and
  behavior.

## PL-010 — Align the breadcrumb row with the SW logo

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Main content layout — breadcrumb row
- Screenshot: Not captured

The main breadcrumb row does not align with the SW logo on the same horizontal
plane because of padding in the main content area. The SW logo should remain in
its current position; correct the alignment by adjusting the main-area
padding.

Acceptance criteria:

- The main breadcrumb row aligns horizontally with the SW logo.
- The SW logo's position and sidebar spacing remain unchanged.
- The alignment correction is made through the main content area's padding.
- Other main-page content maintains intentional and consistent spacing after
  the adjustment.
