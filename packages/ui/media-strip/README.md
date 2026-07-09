# media-strip

A reorderable, nestable strip of media items — drag to reorder, drag into a
collection card to nest, keyboard-accessible, virtualized for large lists.
Not a video-editing timeline (no playhead, ruler, or zoom) — think asset
picker / filmstrip, not clip editor.

This is a quickstart for consumers. For the data flow, adapter contract,
and invariants to know before touching drag-and-drop internals, see
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Install

No build step — this package is consumed as TypeScript source directly via
workspace linking. Import from `@storyboard/ui/media-strip` and, separately,
whichever DnD adapter you use:

```ts
import {
  MediaStrip,
  MediaStripBoard,
  createImageTimelineItem,
  trustedCollectionId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
} from "@storyboard/ui/media-strip";
import { dndKitMediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/dnd-kit-adapter";
```

Adapters are deep imports, not re-exported from the root — each one pulls
in a different optional peer dependency, so importing `MediaStrip` never
forces you to have all three resolvable. Pick one:

| Export | Import path | Status |
|---|---|---|
| `dndKitMediaStripDndAdapter` | `.../adapters/dnd-kit-adapter` | **Recommended.** Fully tested, both pointer and keyboard paths covered. |
| `nativeHtml5MediaStripDndAdapter` | `.../adapters/native-html5-adapter` | Fully tested. Use if you need native browser DnD (e.g. dragging files in from the OS). |
| `experimentalPragmaticMediaStripDndAdapter` | `.../adapters/pragmatic-adapter` | **Experimental** (name says so). Renders and typechecks, but its actual drag interaction isn't covered by any automated test — a regression wouldn't be caught by CI. See ARCHITECTURE.md's "Known gaps." Don't ship on it. |

## Minimal example

```tsx
"use client";

import { useCallback, useState } from "react";
import {
  MediaStrip,
  MediaStripBoard,
  applyTimelineItemCommand,
  createImageTimelineItem,
  trustedCollectionId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
  type TimelineItemId,
} from "@storyboard/ui/media-strip";
import { dndKitMediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/dnd-kit-adapter";

const collectionId = trustedCollectionId("scene-1");

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`Invalid seed item: ${JSON.stringify(result.error)}`);
  return result.value;
}

export function AssetStrip() {
  const [collections, setCollections] = useState<ReadonlyMap<CollectionId, TimelineCollection>>(
    () => new Map([
      [collectionId, {
        id: collectionId,
        name: "Scene 1",
        items: [
          unwrap(createImageTimelineItem({
            id: "img-1", name: "Wide shot", src: "/img/wide.png",
            startTimeSeconds: 0, durationSeconds: 4,
          })),
        ],
      }],
    ])
  );
  const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>([]);

  const handleMoveItem = useCallback((command: TimelineItemCommand) => {
    setCollections((prev) => {
      const result = applyTimelineItemCommand({ collectionsById: prev, command });
      return result.ok ? result.collectionsById : prev;
    });
  }, []);

  return (
    <MediaStripBoard
      collectionsById={collections}
      dndAdapter={dndKitMediaStripDndAdapter}
      visibleCollectionIds={[collectionId]}
      onMoveItem={handleMoveItem}
    >
      <MediaStrip
        collectionId={collectionId}
        heading="Scene 1"
        selectedIds={selectedIds}
        onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
      />
    </MediaStripBoard>
  );
}
```

`MediaStripBoard` is a controlled component — it never mutates
`collectionsById` itself. Every drag/nest/reorder comes out as a
`TimelineItemCommand` through `onMoveItem`; run it through
`applyTimelineItemCommand` (the package's own pure reducer) and feed the
result back in as props, as above.

## Multiple strips, and selection across them

`MediaStripBoard` can wrap more than one `<MediaStrip>` — cross-strip
drag, keyboard move-between-strips (Arrow Up/Down), and nesting all work
across siblings automatically as long as they share one `MediaStripBoard`
and `collectionsById`. If you share one `selectedIds` array across
multiple strips, merge on `onSelectionChange` using the `collectionId` it
now reports — replacing the whole array with `selection.selectedIds`
directly will clobber other strips' selections:

```tsx
const handleSelectionChange = useCallback((selection: MediaStripSelection) => {
  setSelectedIds((prev) => {
    const changedCollectionItemIds = new Set(
      collections.get(selection.collectionId)?.items.map((item) => item.id) ?? []
    );
    const otherStripsSelectedIds = prev.filter((id) => !changedCollectionItemIds.has(id));
    return [...otherStripsSelectedIds, ...selection.selectedIds];
  });
}, [collections]);
```

## Ingesting untrusted data

`createImageTimelineItem`/`createVideoTimelineItem`/`createCollectionTimelineItem`
and `validateTimelineItem` assume the input already has a valid
discriminated-union shape — safe for data you constructed yourself, not
safe for `unknown` (an API response, a parsed JSON file). For that, use
the `parse*` functions instead — they never throw, returning a typed
`TimelineItemParseError` on any malformed input:

```ts
import { parseTimelineCollectionsById } from "@storyboard/ui/media-strip";

const result = parseTimelineCollectionsById(await response.json());
if (!result.ok) {
  // result.error is a typed TimelineCollectionsByIdParseError
  return;
}
setCollections(result.value);
```

## Keyboard support

Focus an item's reorder handle and press Enter/Space to pick it up, then:

| Key | Action |
|---|---|
| `←` / `→` | Reorder within the current strip |
| `↑` / `↓` | Move to the strip above/below |
| `Home` / `End` | Jump to the start/end of the strip |
| `N` | Nest into an adjacent collection card |
| `U` | Move out to the parent collection |
| `Enter` / `Space` | Drop |
| `Escape` | Cancel and revert |

## Development-time checks

In non-production builds, `MediaStripBoard` validates the `collectionsById`
graph it's given (duplicate item ids across collections, cycles, a
collection claimed by more than one parent) and `console.warn`s loudly
if it's malformed — these shapes don't throw at runtime, they just make
drag-and-drop silently resolve to the wrong target. See ARCHITECTURE.md
for exactly what's checked and what's deliberately not (lazily-unloaded
collections are expected, not an error).

## Testing this package

`*.test.ts` files are plain-Node unit tests (`vitest --project=unit` from
`apps/storybook`) for everything in `core/`. `*.stories.tsx` files'
`play` functions are this package's interaction/E2E suite, run in real
Chromium (`vitest --project=storybook`) — not just visual documentation.
See ARCHITECTURE.md's "Testing strategy" for the full breakdown.
