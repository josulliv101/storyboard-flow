# Punch List 05

## PL5-001 — Keep selected-item borders visible at grid edges

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Graph grid — selected item border
- Screenshot: [Selected border clipped at the left edge](screenshots/PL5-001-selected-edge-border-clipping.png)

When a selected item sits against the left edge of the grid, the grid’s
scrolling boundary clips the outside half of its yellow selection border. The
same problem can occur at the right edge. Keep the complete selection border
visible on every side of edge-positioned cards.

Acceptance criteria:

- The complete yellow selection border remains visible on a card in the
  leftmost grid column.
- The complete yellow selection border remains visible on a card in the
  rightmost grid column.
- Top and bottom selection borders remain fully visible as well.
- The treatment is consistent for collection, image, and video items.
- Disabled items use the same complete selected border.
- Changing grid size, responsive column count, or viewport width does not
  reintroduce clipping.
- Grid item alignment and the flush, padding-free board layout remain
  unchanged.
- Strip-view selection remains visually consistent and is not regressed.

## PL5-002 — Reduce the empty-collection drag-preview icon

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Collection item — empty drag preview
- Screenshot: Not captured

An empty collection uses the folder-with-right-arrow glyph as its drag
preview. Reduce that glyph’s size within the drag element without changing the
corresponding icon on collection cards.

Acceptance criteria:

- The folder-with-right-arrow glyph is visibly smaller in the empty
  collection drag preview.
- The glyph remains centered horizontally and vertically.
- Its lighter stroke treatment remains unchanged.
- The collection-card icon retains its current size.
- Non-empty collection drag previews remain image-based and unchanged.
- Multi-item drag count badges remain unaffected.

## PL5-003 — Reposition disabled badges and preserve media-type labels

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Grid and strip items — disabled status and media-type labels
- Screenshot: Not captured

Move the Disabled status badge from the upper-right corner to the lower-right
corner with clear inset spacing. Keep the Image or Video label in the
lower-left fully opaque and readable when the underlying item artwork is
disabled and muted.

Acceptance criteria:

- Direct and inherited disabled badges appear at the bottom-right.
- The disabled badge has balanced space from the right and bottom card edges.
- The badge remains fully opaque and readable.
- Image and Video labels remain fully opaque and are not grayscale when their
  item is disabled.
- The underlying artwork retains its disabled opacity and grayscale treatment.
- The lower-left media label and lower-right disabled badge do not overlap.
- Disabled collection metadata reserves room for the badge and remains
  readable.
- Selected, grid, and strip states use the same positioning.

## PL5-004 — Restore the projects-page header row and top spacing

- Status: Complete
- URL: http://localhost:3000/
- Area: Timeline Projects page — page header and New Project form
- Screenshot: Not captured

The New Project form has fallen onto its own full-width row, and the projects
page content sits too close to the top edge. Restore the form beside the
Timeline Projects title and supporting copy at the normal desktop/tablet
layout, and add page-local breathing room above the header.

Acceptance criteria:

- Timeline Projects, its blurb, and the New Project form share one header row
  at supported desktop and tablet widths.
- The New Project form has a bounded width rather than stretching across the
  page.
- The header can stack cleanly on genuinely narrow screens without horizontal
  overflow.
- The projects page has visible breathing room above the header.
- The page-local spacing does not change graph-page breadcrumb alignment.
- The Saved Projects section and project-card grid retain their current width
  and spacing.

## PL5-005 — Clean up the preview divider and contain the playhead

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Preview transport, resize divider, and graph playhead
- Screenshot: [Preview border and playhead overflow](screenshots/PL5-005-preview-playhead-overflow.png)

The preview transport has a bottom border immediately above the resize grip,
which makes the divider look visually doubled. At the start of the timeline,
the seek thumb is centered on the grid's left edge and its outer half can
remain visible beside the sticky preview or breadcrumb row. That overhang must
be hidden only while it passes behind either sticky region—not when the
timeline is normally visible.

Acceptance criteria:

- The preview transport has no bottom border competing with the resize grip.
- The resize grip retains its existing height, centered position, and hover
  treatment.
- Timeline playheads and seek thumbs cannot peek around the left or right edge
  of the sticky preview or breadcrumb row while passing behind them.
- The complete seek thumb remains visible when its timeline row is below the
  preview.
- The preview-only masking does not create a new scrolling container or
  disturb the sticky preview and breadcrumb row.
- Timeline scrolling, scrubbing, and the playhead's in-grid position remain
  unchanged.

## PL5-006 — Isolate assets by project

- Status: Complete
- URL: http://localhost:3000/timeline/project-1784393947379-3a6k68/graph
- Area: Asset palette, media uploads, and provider storage
- Screenshot: Not captured

Each root project owns its own asset library. Asset requests must carry the
current root project ID, pass project ownership checks, and expose only media
assigned to that project. New Cloudinary uploads use a project folder beneath
the existing app and user folders.

Acceptance criteria:

- Opening the asset palette in one project cannot list assets from another.
- Search, folders, tags, pagination, and provider switching retain the project
  scope.
- OS file drops upload into the current root project's asset scope, including
  when dropped into a nested collection.
- Cloudinary stores new media under `<app>/<user>/<project>/...`.
- The Firebase Storage fallback and optional S3 provider use equivalent
  user/project boundaries.
- Asset list and upload routes reject missing, invalid, inaccessible, or
  unknown project IDs.
- Existing unassigned assets are not silently shared into new projects.
- The provider-neutral asset model represents project membership as an array,
  while current assets belong to exactly one project.
