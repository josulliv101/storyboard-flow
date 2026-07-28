# Punch List 02

## PL2-001 — Refine collection metadata separation and name spacing

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid view — collection item UI
- Screenshot: Not captured

The collection item’s duration and item count should be visually separated by
a slash. The collection name also needs more surrounding space because it
currently sits too close to the card borders and the preview image above it.

Acceptance criteria:

- Duration and item count are separated by a slash, for example
  `8.7s / 2 items`.
- Singular and plural item labels remain grammatically correct.
- The collection name has more horizontal padding from the card borders.
- The collection name has more vertical space between it and the preview
  image.
- The added spacing remains balanced and readable at every supported item
  size without clipping or unwanted wrapping.

## PL2-002 — Make the sidebar Trash-area icon unmistakable

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — Trash area above Settings
- Screenshot: Not captured

Replace the current Trash-area icon with a clearer folder-and-trash
composition. The preferred direction is either a large folder with a
prominent trash symbol centered or positioned at its upper-right, or a large
trash symbol with a smaller folder badge at its upper-right. Choose the
composition that remains clearest at the sidebar’s rendered size.

Acceptance criteria:

- The icon visibly combines the concepts of a folder or storage area and
  trash.
- The trash symbol is large and clear enough to recognize immediately at the
  sidebar’s default size.
- The composition remains legible in its default, hover, focused, active, and
  drag-feedback states.
- It remains visually distinguishable from the ordinary trash-bucket icon
  used to delete a selected item.
- The icon stays in the existing Trash-area position directly above Settings.

## PL2-003 — Show Paste only when clipboard content is available

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — selected-item action context
- Screenshot: Not captured

When an item is selected and the context-aware sidebar actions appear, hide
the Paste icon if there is nothing available to paste. Show the action only
when the graph clipboard contains an item that can be pasted.

Acceptance criteria:

- Paste is absent from the selected-item sidebar when the graph clipboard is
  empty.
- Paste appears as soon as pasteable clipboard content is available.
- The visible Paste action retains its existing behavior and availability
  rules.
- Copying or cutting an item updates the sidebar without requiring a page
  reload or reselection.
- Clearing the clipboard hides Paste again and preserves the ordering and
  spacing of the remaining actions.

## PL2-004 — Combine folder and media concepts in the Assets icon

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Sidebar icon bar — Assets
- Screenshot: Not captured

Update the Assets icon so it communicates both a media library and a folder or
stored collection. The result should read as the place where project media is
organized, rather than as a generic image-only action.

Acceptance criteria:

- The icon visibly combines a folder or library concept with recognizable
  media imagery.
- It remains clear and legible at the sidebar’s default rendered size.
- The visual is distinct from the Trash-area folder-and-trash icon and the
  Collection tool.
- The icon remains recognizable in its default, hover, focused, active, and
  drawer-open states.
- The Assets icon’s existing position and behavior remain unchanged.

## PL2-005 — Subdue the selected-item amber treatment

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid items and sidebar — selected-item context
- Screenshot: Not captured

The selected item’s amber border and the matching amber treatment on its
context-aware sidebar actions currently stand out too strongly. Preserve a
visible relationship between the selected item and its available actions, but
make the shared color treatment quieter and less dominant.

Acceptance criteria:

- A selected item remains clearly identifiable without an overly bright or
  visually dominant border.
- The contextual sidebar actions retain a subtle visual relationship to the
  selected item.
- The amber hue, opacity, border weight, background tint, or a combination of
  these is reduced to create a more subdued result.
- Selection and action states remain distinguishable from hover, focus,
  disabled, drag, and error states.
- Text and icons continue to meet readable contrast requirements in the
  subdued treatment.

## PL2-006 — Make every breadcrumb item editable with one click

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph/timeline-mrw5pjun10npp2
- Area: Graph header — timeline breadcrumb
- Screenshot: Not captured

Every timeline breadcrumb item should support inline renaming. Replace the
current behavior, where only the last item is editable by double-clicking, with
a consistent interaction across the entire breadcrumb: a subtle hover state
indicates editability, and a single click enters inline-edit mode.

Acceptance criteria:

- Every breadcrumb item, including ancestors and the current timeline, can be
  edited in place.
- Hovering an editable breadcrumb item applies a subtle background or
  equivalent visual treatment that indicates interactivity.
- A single click on any breadcrumb item replaces its label with a focused
  inline text editor.
- Pressing Enter commits the edited name.
- Clicking or moving focus outside the editor commits the edited name.
- The updated name is reflected consistently anywhere that timeline name is
  shown.
- The interaction remains keyboard accessible, with a visible focus state and
  no layout jump when entering or leaving edit mode.
- Editing one breadcrumb item does not accidentally rename or activate another
  item.

## PL2-007 — Replace the Projects-page loading indicator with skeletons

- Status: Completed
- URL: http://localhost:3000/
- Area: Timeline Projects — initial project-list loading state
- Screenshot: Not captured

When the Projects page is loading its saved projects, show a skeleton layout
instead of the current generic loading indicator. The placeholders should
closely represent the project cards that will replace them.

Acceptance criteria:

- The current loading indicator is removed from the saved-project loading
  state.
- The page displays project-card skeletons while project data is loading.
- Skeleton dimensions and spacing closely match the loaded project-card
  layout to minimize layout shift.
- Stable page content, such as the page heading and new-project controls,
  remains available while the saved-project list loads.
- Skeletons are replaced cleanly by loaded projects, the empty state, or an
  error state when the request finishes.
- The loading region exposes an appropriate accessible busy or loading state.

## PL2-008 — Improve the breadcrumb-row aggregate text contrast

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph header — centered clip-count and duration summary
- Screenshot: Not captured

The centered aggregate text in the breadcrumb row, such as
“5 clips · 24.0s,” blends too closely into the header background. Make it
slightly more visible and easier to read without allowing it to compete with
the breadcrumb or primary controls.

Acceptance criteria:

- The centered clip-count and duration summary has moderately stronger
  contrast against the header background.
- The text remains visually secondary to the breadcrumb and primary actions.
- The updated treatment remains readable in normal, selected-item, and
  drag-feedback states.
- Clip-count and duration values, formatting, position, and behavior remain
  unchanged.
- The text continues to meet accessible contrast expectations for supporting
  interface information.

## PL2-009 — Make “Drop to nest” larger and easier to read

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — nested-drop feedback
- Screenshot: Not captured

When an item is dragged over a collection and nesting is available, make the
“Drop to nest” label larger and more prominent. The collection preview image,
name, and metadata currently compete with the label, so apply a stronger
lightened or opaque veil over the underlying collection content while the nest
target is active.

Acceptance criteria:

- The “Drop to nest” label uses a noticeably larger, more readable type size.
- The label remains positioned at the bottom center of the collection item.
- An active nest target visually suppresses the underlying preview image,
  collection name, and metadata with a lightened or more opaque overlay.
- The label has strong contrast against both light and dark collection
  imagery.
- The valid-nest treatment remains clearly distinct from the invalid or
  cycle-prevention state.
- The stronger feedback does not change the collection’s drop-target geometry
  or interfere with completing the drop.

## PL2-010 — Stabilize the blue drop indicator at grid-row starts

- Status: Completed
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid view — first-position and row-start drop boundaries
- Screenshot: Not captured

The blue vertical drop indicator is now centered correctly for most gaps, but
the boundary before the first item still has two alternate visual positions.
The problem occurs at the very beginning of the grid and may also affect a
drop boundary at the start of a wrapped grid row. These row-start boundaries
should resolve to one stable indicator position.

Acceptance criteria:

- Dropping before the first item in the grid shows the blue indicator in one
  consistent position.
- A drop boundary at the start of any wrapped grid row also uses one stable
  position.
- The indicator does not jump between alternate left or right placements
  while the pointer remains over the same row-start boundary.
- The row-start indicator is centered in the intended leading gap using the
  same spacing logic as ordinary between-item boundaries.
- The item is inserted at the exact position represented by the indicator.
- Behavior remains stable across responsive column-count and item-size
  changes.
