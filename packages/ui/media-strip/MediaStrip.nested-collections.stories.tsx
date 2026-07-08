import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback } from "react";
import { expect, within, userEvent } from "storybook/test";

import { MediaStrip } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { dndKitMediaStripDndAdapter } from "./adapters/dnd-kit-adapter";
import { nativeHtml5MediaStripDndAdapter } from "./adapters/native-html5-adapter";
import { pragmaticMediaStripDndAdapter } from "./adapters/pragmatic-adapter";
import {
  asCollectionId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineCollectionsById,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import { type MediaStripDndAdapter } from "./media-strip-dnd.types";
import {
  createImageTimelineItem,
  createCollectionTimelineItem,
} from "./core/media-strip.validation";
import { applyTimelineItemCommand } from "./core/media-strip.collection-ops";
import {
  unwrapResult,
  createPhotoThumbnail,
  simulatePointerDrag,
} from "./media-strip.stories-helpers";

// Nested-collection ("folder") demo: dragging or keyboard-nesting an item
// into a collection card. Nested under "MediaStrip" alongside the other
// MediaStrip.*.stories.tsx files' groups in Storybook's sidebar (see each
// file's title).

const meta = {
  title: "UI/MediaStrip/MediaStrip/Nested Collections",
  // Single shared decorator — story-level decorators STACK with this one, so
  // per-story copies double-wrap the canvas.
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function StatefulNestedCollectionsBoard({
  dndAdapter = dndKitMediaStripDndAdapter,
}: {
  dndAdapter?: MediaStripDndAdapter;
}) {
  const [collections, setCollections] = useState<TimelineCollectionsById>(() => {
    const rootItems: TimelineItem[] = [
      unwrapResult(createImageTimelineItem({
        id: "img-1",
        name: "Beautiful Sunset",
        src: createPhotoThumbnail("beautiful-sunset"),
        posterSrcs: [createPhotoThumbnail("beautiful-sunset")],
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
      unwrapResult(createCollectionTimelineItem({
        id: "card-col-b",
        name: "Holiday Folder",
        collectionId: asCollectionId("col-b"),
        itemCount: 2,
        startTimeSeconds: 0,
        durationSeconds: 10,
      })),
      unwrapResult(createCollectionTimelineItem({
        id: "card-col-c",
        name: "Empty Folder",
        collectionId: asCollectionId("col-c"),
        itemCount: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
    ];

    const colBItems: TimelineItem[] = [
      unwrapResult(createImageTimelineItem({
        id: "img-2",
        name: "Beach Day",
        src: createPhotoThumbnail("beach-day"),
        posterSrcs: [createPhotoThumbnail("beach-day")],
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
      unwrapResult(createCollectionTimelineItem({
        id: "card-col-d",
        name: "Trip Subfolder",
        collectionId: asCollectionId("col-d"),
        itemCount: 1,
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
      unwrapResult(createImageTimelineItem({
        id: "img-3",
        name: "Mountain Hike",
        src: createPhotoThumbnail("mountain-hike"),
        posterSrcs: [createPhotoThumbnail("mountain-hike")],
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
    ];

    return new Map<CollectionId, TimelineCollection>([
      [asCollectionId("col-a"), {
        id: asCollectionId("col-a"),
        name: "Root Collection A",
        items: rootItems,
      }],
      [asCollectionId("col-b"), {
        id: asCollectionId("col-b"),
        name: "Holiday Folder",
        items: colBItems,
      }],
      [asCollectionId("col-c"), {
        id: asCollectionId("col-c"),
        name: "Empty Folder",
        items: [],
      }],
      [asCollectionId("col-d"), {
        id: asCollectionId("col-d"),
        name: "Trip Subfolder",
        items: [
          unwrapResult(createImageTimelineItem({
            id: "img-4",
            name: "Postcard Detail",
            src: createPhotoThumbnail("postcard-detail"),
            posterSrcs: [createPhotoThumbnail("postcard-detail")],
            startTimeSeconds: 0,
            durationSeconds: 5,
          })),
        ],
      }],
    ]);
  });

  const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>([]);

  const handleMoveOrDrop = useCallback((command: TimelineItemCommand) => {
    setCollections((prev) => {
      const result = applyTimelineItemCommand({ collectionsById: prev, command });
      return result.ok ? result.collectionsById : prev;
    });
  }, []);

  return (
    <MediaStripBoard
      collectionsById={collections}
      dndAdapter={dndAdapter}
      visibleCollectionIds={[asCollectionId("col-a")]}
      onMoveItem={handleMoveOrDrop}
    >
      <div className="flex flex-col gap-8 p-4 bg-zinc-950 rounded-lg">
        <div>
          <h3 className="text-md font-bold mb-1">Nested Collections Demo</h3>
          <p className="text-xs text-zinc-400 mb-4">
            - Drag and drop "Beautiful Sunset" onto the center of "Holiday Folder" or "Empty Folder" cards to nest them.
            <br />
            - Try keyboard reordering: focus the reorder handle of "Beautiful Sunset", press Space, move next to "Holiday Folder", and press N to nest it!
          </p>
        </div>
        <MediaStrip
          collectionId={asCollectionId("col-a")}
          heading="Root Collection (Strip)"
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
        />
        <MediaStrip
          collectionId={asCollectionId("col-b")}
          heading="Holiday Folder Contents"
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
        />
        <MediaStrip
          collectionId={asCollectionId("col-c")}
          heading="Empty Folder Contents"
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
        />
      </div>
    </MediaStripBoard>
  );
}

export const DeeplyNestedCollections: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
};

export const DeeplyNestedCollectionsPragmaticDnd: Story = {
  render: () => <StatefulNestedCollectionsBoard dndAdapter={pragmaticMediaStripDndAdapter} />,
};

export const DeeplyNestedCollectionsNativeHtml5: Story = {
  render: () => <StatefulNestedCollectionsBoard dndAdapter={nativeHtml5MediaStripDndAdapter} />,
};

export const PointerDragMediaItemIntoCollection: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="img-1"]') as HTMLElement;
    const emptyFolderCard = canvas.getByRole("button", { name: /empty folder/i });

    // "Beautiful Sunset" is a plain media item; dropping it dead-center on
    // the "Empty Folder" collection card should nest it inside, not reorder
    // it next to the card.
    await simulatePointerDrag(handle, emptyFolderCard);

    await expect(await canvas.findByText(/moved "beautiful sunset" into collection/i)).toBeInTheDocument();

    const emptyFolderStrip = canvasElement.querySelector("[data-collection-id='col-c']") as HTMLElement;
    await expect(within(emptyFolderStrip).getByRole("button", { name: /beautiful sunset/i })).toBeInTheDocument();
  },
};

export const PointerDragCollectionIntoCollection: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="card-col-b"]') as HTMLElement;
    const emptyFolderCard = canvas.getByRole("button", { name: /empty folder/i });

    // "Holiday Folder" (col-b) has no relationship to "Empty Folder" (col-c)
    // — nesting one collection card into another, unrelated one is valid.
    await simulatePointerDrag(handle, emptyFolderCard);

    await expect(await canvas.findByText(/moved "holiday folder" into collection/i)).toBeInTheDocument();

    const emptyFolderStrip = canvasElement.querySelector("[data-collection-id='col-c']") as HTMLElement;
    await expect(within(emptyFolderStrip).getByRole("button", { name: /holiday folder/i })).toBeInTheDocument();

    const rootStrip = canvasElement.querySelector("[data-collection-id='col-a']") as HTMLElement;
    await expect(within(rootStrip).queryByRole("button", { name: /holiday folder/i })).not.toBeInTheDocument();
  },
};

export const KeyboardNestIntoAdjacentCollection: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="img-2"]') as HTMLElement;

    // "Beach Day" (img-2) sits right before "Trip Subfolder" (card-col-d) in
    // the Holiday Folder strip: [Beach Day, Trip Subfolder, Mountain Hike].
    // Moving it one step right makes Trip Subfolder its *previous* neighbor
    // with Mountain Hike (not a collection) next — exercising the
    // prevItem-priority branch of the nest lookup, which the pointer-drag
    // nesting tests never hit (those always land dead-center on a target).
    handle.focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText(/moved "beach day" to position 2/i)).toBeInTheDocument();

    await userEvent.keyboard("n");
    await expect(
      await canvas.findByText(/moved "beach day" into collection "trip subfolder"/i)
    ).toBeInTheDocument();

    const holidayFolderStrip = canvasElement.querySelector("[data-collection-id='col-b']") as HTMLElement;
    await expect(within(holidayFolderStrip).queryByRole("button", { name: /beach day/i })).not.toBeInTheDocument();
  },
};

export const KeyboardMoveToParentCollection: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="img-3"]') as HTMLElement;

    // "Mountain Hike" (img-3) lives in the Holiday Folder (col-b), whose
    // parent is the Root Collection (col-a). Pressing U should move it back
    // out, landing right after the "Holiday Folder" card in the root strip.
    handle.focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("u");

    await expect(
      await canvas.findByText(/moved "mountain hike" out to collection "root collection a"/i)
    ).toBeInTheDocument();

    const holidayFolderStrip = canvasElement.querySelector("[data-collection-id='col-b']") as HTMLElement;
    await expect(within(holidayFolderStrip).queryByRole("button", { name: /mountain hike/i })).not.toBeInTheDocument();

    const rootStrip = canvasElement.querySelector("[data-collection-id='col-a']") as HTMLElement;
    await expect(within(rootStrip).getByRole("button", { name: /mountain hike/i })).toBeInTheDocument();
  },
};

export const KeyboardMoveToParentAtRootIsNoOp: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="img-1"]') as HTMLElement;

    // "Beautiful Sunset" (img-1) already lives in the root collection, which
    // has no parent — U should announce the boundary and leave it in place.
    handle.focus();
    await userEvent.keyboard(" ");
    await userEvent.keyboard("u");

    await expect(
      await canvas.findByText(/already at the top level; no parent collection to move out to/i)
    ).toBeInTheDocument();

    const rootStrip = canvasElement.querySelector("[data-collection-id='col-a']") as HTMLElement;
    await expect(within(rootStrip).getByRole("button", { name: /beautiful sunset/i })).toBeInTheDocument();
  },
};

export const PointerDragRejectsInvalidCycle: Story = {
  render: () => <StatefulNestedCollectionsBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="card-col-b"]') as HTMLElement;
    // "Trip Subfolder" (col-d) already lives inside "Holiday Folder" (col-b)'s
    // own contents, so nesting Holiday Folder into Trip Subfolder would make
    // col-b contain itself.
    const tripSubfolderCard = canvas.getByRole("button", { name: /trip subfolder/i });

    await simulatePointerDrag(handle, tripSubfolderCard);

    await expect(
      await canvas.findByText(/cannot move a collection into itself or one of its nested collections/i)
    ).toBeInTheDocument();

    // The rejected drag must leave the model untouched: Holiday Folder is
    // still in the root strip, not moved into Trip Subfolder.
    const rootStrip = canvasElement.querySelector("[data-collection-id='col-a']") as HTMLElement;
    const holidayFolderCard = within(rootStrip).getByRole("button", { name: /holiday folder/i });
    await expect(holidayFolderCard).toBeInTheDocument();

    // Sighted pointer users get a visual cue too, not just the aria-live
    // announcement above.
    await expect(holidayFolderCard).toHaveAttribute("data-rejected", "true");
  },
};
