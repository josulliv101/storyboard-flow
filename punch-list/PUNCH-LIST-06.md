# Punch List 06

## PL6-001 — Remove text behind the collection folder icon

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Graph grid — collection card preview
- Screenshot: [Text visible behind the middle collection icon](screenshots/PL6-001-collection-text-behind-folder-icon.png)

The middle collection card displays faint fallback text behind its centered
folder-with-arrow icon. Remove that text so the preview area contains only the
collection icon when no usable preview image is shown.

Acceptance criteria:

- No fallback, empty-state, or image-alt text is visible behind the collection
  folder icon.
- The folder-with-arrow icon remains centered and fully visible.
- Empty collections and collections with unavailable previews use the same
  clean icon-only fallback.
- Collection name, duration, and item-count metadata remain unchanged.
- Image and video item previews are unaffected.

## PL6-002 — Oversized original storage

- Status: Excluded at user request
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Native file drop — Cloudinary upload pipeline
- Screenshot: Not captured

Do not add a second storage provider or an oversized-original overflow
destination. Cloudinary remains the configured asset provider. Its existing
chunked upload and explicit 413 error handling remain unchanged.

## PL6-003 — Resolve collection previews through nested containers

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph/timeline-ms3mv1s8quqihc
- Area: Graph grid — nested collection preview
- Screenshot: [Nested video does not provide a clear collection preview](screenshots/PL6-003-nested-video-missing-collection-preview.png)

The second collection contains a video, but its collection card does not show
that video's poster as a clear preview. Preview selection appears to stop at a
container boundary instead of resolving usable media from nested descendants.

Acceptance criteria:

- A collection with directly contained video media uses that video's poster as
  its preview.
- A collection whose first usable media is inside another nested collection
  resolves that descendant recursively.
- The preview is clearly visible and is not obscured by fallback text or the
  empty-collection treatment.
- The folder-with-arrow overlay remains available as the collection affordance
  without replacing a valid media preview.
- Empty collections retain the icon-only fallback.
- Missing or invalid media URLs fall through to the next usable descendant
  without causing an infinite traversal.
- Grid and strip views use the same preview-selection result.

## PL6-004 — Respect a video clip's front trim in collection previews

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph
- Area: Collection cards and nested collection preview thumbnails
- Screenshot: Not captured

When a video clip supplies the representative image for a collection, use the
frame at the beginning of its visible trimmed range rather than the source
video's first frame.

Acceptance criteria:

- A video with a positive front trim uses the frame at `trimIn` as its
  collection preview.
- Untrimmed videos retain their existing poster URL.
- Image previews are unchanged.
- The trim offset survives stored collection summaries and nested collection
  preview propagation.
- Providers that cannot address a frame by timestamp retain the existing
  poster as a safe fallback.
- Collection cards, drag previews, and sub-timeline thumbnails use the same
  resolved frame.

## PL6-005 — Preload video frames ahead of horizontal scrolling

- Status: Complete
- URL: http://localhost:3000/timeline/project-1785180655904-uc9isj/graph/timeline-ms3mv1s8quqihc
- Area: Virtualized strip video thumbnails
- Screenshot: Not captured

Long timelines can extend far beyond the viewport. When a user pans forward,
video frame images should already be available instead of appearing after the
new cards enter view.

Acceptance criteria:

- Graph strips keep a bounded eight-card look-ahead beyond each viewport edge.
- Video frames inside that mounted look-ahead begin loading immediately.
- Frame decoding remains asynchronous so completed images do not stall
  scrolling.
- The full timeline is not mounted or preloaded at once.
- Focused and nested timeline strips use the same preload policy.
