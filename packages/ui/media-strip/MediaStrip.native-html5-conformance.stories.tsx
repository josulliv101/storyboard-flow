import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useMemo } from "react";
import { expect, within, waitFor } from "storybook/test";

import { MediaStrip } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { nativeHtml5MediaStripDndAdapter } from "./adapters/native-html5-adapter";
import {
  asCollectionId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineCollectionsById,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import {
  createImageTimelineItem,
  createCollectionTimelineItem,
} from "./core/media-strip.validation";
import { applyTimelineItemCommand } from "./core/media-strip.collection-ops";
import {
  unwrapResult,
  createImg,
  waitForLayout,
  simulateNativeDrag,
  simulateNativeDragToPoint,
  simulateNativeDragCancel,
} from "./media-strip.stories-helpers";

// Cross-adapter conformance suite: the same nine scenarios already covered
// for the dnd-kit adapter (see MediaStrip.reorder.stories.tsx and
// MediaStrip.nested-collections.stories.tsx) run again here against the
// native-html5 adapter. Adapters differ in DOM mechanics but must resolve
// to the same TimelineItemCommand semantics — this file is what actually
// checks that promise instead of just asserting it in a comment. See
// ARCHITECTURE.md for why the pragmatic adapter isn't included here yet.
//
// Nested under "MediaStrip" alongside the other MediaStrip.*.stories.tsx
// files' groups in Storybook's sidebar (see each file's title).

const meta = {
  title: "UI/MediaStrip/MediaStrip/Adapter Conformance",
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

function getItemNames(strip: HTMLElement): (string | null)[] {
  return within(strip)
    .getAllByRole("button", { name: /item/i })
    .map((el) => el.getAttribute("aria-label"));
}

// --- Demo A: three strips, for same-strip / cross-strip / cancel scenarios ---

const ThreeStripDemo = () => {
  const [collections, setCollections] = useState<TimelineCollectionsById>(() =>
    new Map<CollectionId, TimelineCollection>([
      [asCollectionId("nh-strip-a"), {
        id: asCollectionId("nh-strip-a"),
        name: "Strip A",
        items: [
          createImg("nh-a1", "Item A1", "#f43f5e", 5),
          createImg("nh-a2", "Item A2", "#ec4899", 6),
          createImg("nh-a3", "Item A3", "#d946ef", 4),
        ],
      }],
      [asCollectionId("nh-strip-b"), {
        id: asCollectionId("nh-strip-b"),
        name: "Strip B",
        items: [
          createImg("nh-b1", "Item B1", "#3b82f6", 5),
          createImg("nh-b2", "Item B2", "#06b6d4", 7),
        ],
      }],
    ])
  );

  const handleMoveItem = useCallback((command: TimelineItemCommand) => {
    setCollections((prev) => {
      const result = applyTimelineItemCommand({ collectionsById: prev, command });
      return result.ok ? result.collectionsById : prev;
    });
  }, []);

  const visibleCollectionIds = useMemo(
    () => [asCollectionId("nh-strip-a"), asCollectionId("nh-strip-b")],
    []
  );

  return (
    <MediaStripBoard
      collectionsById={collections}
      dndAdapter={nativeHtml5MediaStripDndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <div className="flex flex-col gap-8 p-4 bg-zinc-950 rounded-lg">
        <MediaStrip collectionId={asCollectionId("nh-strip-a")} heading="Strip A" selectedIds={[]} onSelectionChange={() => { }} />
        <MediaStrip collectionId={asCollectionId("nh-strip-b")} heading="Strip B" selectedIds={[]} onSelectionChange={() => { }} />
      </div>
    </MediaStripBoard>
  );
};

export const ConformanceNativeHtml5SameStripBefore: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const thirdItem = canvas.getByRole("button", { name: /item a3/i });

    await waitForLayout(thirdItem);
    const targetRect = thirdItem.getBoundingClientRect();
    await simulateNativeDragToPoint(handle, thirdItem, {
      x: targetRect.left + targetRect.width * 0.15,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripA = canvasElement.querySelector("[data-strip-id='nh-strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripA);
      expect(names[0]).toMatch(/item a2/i);
      expect(names[1]).toMatch(/item a1/i);
      expect(names[2]).toMatch(/item a3/i);
    });
  },
};

export const ConformanceNativeHtml5SameStripAfter: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const thirdItem = canvas.getByRole("button", { name: /item a3/i });

    await waitForLayout(thirdItem);
    const targetRect = thirdItem.getBoundingClientRect();
    await simulateNativeDragToPoint(handle, thirdItem, {
      x: targetRect.left + targetRect.width * 0.85,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripA = canvasElement.querySelector("[data-strip-id='nh-strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripA);
      expect(names[0]).toMatch(/item a2/i);
      expect(names[1]).toMatch(/item a3/i);
      expect(names[2]).toMatch(/item a1/i);
    });
  },
};

export const ConformanceNativeHtml5SelfDropIsNoOp: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    // Native `dragover` fires on the source element itself as the pointer
    // moves within its own bounds (nothing removes it from the DOM mid-drag,
    // unlike dnd-kit's collision search, which filters the active item out
    // before resolveDropTargetInfo ever runs). Dropping on your own right
    // half used to resolve to a real "move to index+1" instead of a no-op —
    // this is the actual adapter-level reproduction of that bug, not just
    // the pure-function unit test in core/media-strip.dnd.test.ts.
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    await waitForLayout(firstItem);
    const selfRect = firstItem.getBoundingClientRect();
    await simulateNativeDragToPoint(handle, firstItem, {
      x: selfRect.left + selfRect.width * 0.85,
      y: selfRect.top + selfRect.height / 2,
    });

    const stripA = canvasElement.querySelector("[data-strip-id='nh-strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripA);
      expect(names[0]).toMatch(/item a1/i);
      expect(names[1]).toMatch(/item a2/i);
      expect(names[2]).toMatch(/item a3/i);
    });
  },
};

export const ConformanceNativeHtml5CrossStripBefore: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvas.getByRole("button", { name: /item b2/i });

    await waitForLayout(targetItem);
    const targetRect = targetItem.getBoundingClientRect();
    await simulateNativeDragToPoint(handle, targetItem, {
      x: targetRect.left + targetRect.width * 0.15,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripB = canvasElement.querySelector("[data-strip-id='nh-strip-b']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripB);
      expect(names[0]).toMatch(/item b1/i);
      expect(names[1]).toMatch(/item a1/i);
      expect(names[2]).toMatch(/item b2/i);
    });
  },
};

export const ConformanceNativeHtml5CrossStripAfter: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvas.getByRole("button", { name: /item b1/i });

    await waitForLayout(targetItem);
    const targetRect = targetItem.getBoundingClientRect();
    await simulateNativeDragToPoint(handle, targetItem, {
      x: targetRect.left + targetRect.width * 0.85,
      y: targetRect.top + targetRect.height / 2,
    });

    const stripB = canvasElement.querySelector("[data-strip-id='nh-strip-b']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripB);
      expect(names[0]).toMatch(/item b1/i);
      expect(names[1]).toMatch(/item a1/i);
      expect(names[2]).toMatch(/item b2/i);
    });
  },
};

export const ConformanceNativeHtml5CancelLeavesModelUnchanged: Story = {
  render: () => <ThreeStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    await simulateNativeDragCancel(handle);

    const stripA = canvasElement.querySelector("[data-strip-id='nh-strip-a']") as HTMLElement;
    await waitFor(() => {
      const names = getItemNames(stripA);
      expect(names[0]).toMatch(/item a1/i);
      expect(names[1]).toMatch(/item a2/i);
      expect(names[2]).toMatch(/item a3/i);
    });
  },
};

// --- Demo B: one populated strip + one empty strip, for container-end ---

const EmptyStripDemo = () => {
  const [stripA, setStripA] = useState<TimelineItem[]>([
    unwrapResult(
      createImageTimelineItem({
        id: "nh-empty-item-1",
        name: "Item 1",
        src: "img.png",
        startTimeSeconds: 0,
        durationSeconds: 4,
      })
    ),
  ]);
  const [stripB, setStripB] = useState<TimelineItem[]>([]);

  const handleMoveItem = useCallback(
    (command: TimelineItemCommand) => {
      if (command.type !== "move") return;
      const { itemId, toCollectionId: toStripId } = command;
      const item = stripA.find((i) => i.id === itemId);
      if (item && toStripId === "nh-empty-strip-b") {
        setStripB([item]);
        setStripA([]);
      }
    },
    [stripA]
  );

  const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [asCollectionId("nh-empty-strip-a"), { id: asCollectionId("nh-empty-strip-a"), name: "Strip A", items: stripA }],
    [asCollectionId("nh-empty-strip-b"), { id: asCollectionId("nh-empty-strip-b"), name: "Strip B", items: stripB }],
  ]), [stripA, stripB]);
  const visibleCollectionIds = useMemo(
    () => [asCollectionId("nh-empty-strip-a"), asCollectionId("nh-empty-strip-b")],
    []
  );

  return (
    <MediaStripBoard
      collectionsById={collectionsById}
      dndAdapter={nativeHtml5MediaStripDndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <div className="flex flex-col gap-8 p-4">
        <MediaStrip collectionId={asCollectionId("nh-empty-strip-a")} heading="Strip A" selectedIds={[]} onSelectionChange={() => { }} />
        <MediaStrip collectionId={asCollectionId("nh-empty-strip-b")} heading="Strip B" selectedIds={[]} onSelectionChange={() => { }} />
      </div>
    </MediaStripBoard>
  );
};

export const ConformanceNativeHtml5ContainerEndDrop: Story = {
  render: () => <EmptyStripDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item 1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;
    const emptyDroppable = canvasElement.querySelector("[data-strip-id='nh-empty-strip-b'] .border-dashed") as HTMLElement;

    await simulateNativeDrag(handle, emptyDroppable);

    await waitFor(() => {
      const stripB = canvasElement.querySelector("[data-strip-id='nh-empty-strip-b']") as HTMLElement;
      expect(within(stripB).queryByText(/no media items yet/i)).not.toBeInTheDocument();
      expect(within(stripB).getByRole("button", { name: /item 1/i })).toBeInTheDocument();
    });
  },
};

// --- Demo C: nested collections, for nest / cycle-rejection scenarios ---

const NestedCollectionsDemo = () => {
  const [collections, setCollections] = useState<TimelineCollectionsById>(() => {
    const rootItems: TimelineItem[] = [
      unwrapResult(createImageTimelineItem({
        id: "nh-nest-img-1",
        name: "Beautiful Sunset",
        src: "img.png",
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
      unwrapResult(createCollectionTimelineItem({
        id: "nh-nest-card-col-b",
        name: "Holiday Folder",
        collectionId: asCollectionId("nh-nest-col-b"),
        itemCount: 1,
        startTimeSeconds: 0,
        durationSeconds: 10,
      })),
      unwrapResult(createCollectionTimelineItem({
        id: "nh-nest-card-col-c",
        name: "Empty Folder",
        collectionId: asCollectionId("nh-nest-col-c"),
        itemCount: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
    ];

    const colBItems: TimelineItem[] = [
      unwrapResult(createCollectionTimelineItem({
        id: "nh-nest-card-col-d",
        name: "Trip Subfolder",
        collectionId: asCollectionId("nh-nest-col-d"),
        itemCount: 0,
        startTimeSeconds: 0,
        durationSeconds: 5,
      })),
    ];

    return new Map<CollectionId, TimelineCollection>([
      [asCollectionId("nh-nest-col-a"), { id: asCollectionId("nh-nest-col-a"), name: "Root", items: rootItems }],
      [asCollectionId("nh-nest-col-b"), { id: asCollectionId("nh-nest-col-b"), name: "Holiday Folder", items: colBItems }],
      [asCollectionId("nh-nest-col-c"), { id: asCollectionId("nh-nest-col-c"), name: "Empty Folder", items: [] }],
      [asCollectionId("nh-nest-col-d"), { id: asCollectionId("nh-nest-col-d"), name: "Trip Subfolder", items: [] }],
    ]);
  });

  const handleMoveOrDrop = useCallback((command: TimelineItemCommand) => {
    setCollections((prev) => {
      const result = applyTimelineItemCommand({ collectionsById: prev, command });
      return result.ok ? result.collectionsById : prev;
    });
  }, []);

  return (
    <MediaStripBoard
      collectionsById={collections}
      dndAdapter={nativeHtml5MediaStripDndAdapter}
      visibleCollectionIds={[asCollectionId("nh-nest-col-a")]}
      onMoveItem={handleMoveOrDrop}
    >
      <div className="flex flex-col gap-8 p-4 bg-zinc-950 rounded-lg">
        <MediaStrip collectionId={asCollectionId("nh-nest-col-a")} heading="Root Collection (Strip)" selectedIds={[]} onSelectionChange={() => { }} />
        <MediaStrip collectionId={asCollectionId("nh-nest-col-b")} heading="Holiday Folder Contents" selectedIds={[]} onSelectionChange={() => { }} />
        <MediaStrip collectionId={asCollectionId("nh-nest-col-c")} heading="Empty Folder Contents" selectedIds={[]} onSelectionChange={() => { }} />
      </div>
    </MediaStripBoard>
  );
};

export const ConformanceNativeHtml5MediaIntoCollection: Story = {
  render: () => <NestedCollectionsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="nh-nest-img-1"]') as HTMLElement;
    const emptyFolderCard = canvas.getByRole("button", { name: /empty folder/i });

    await simulateNativeDrag(handle, emptyFolderCard);

    await expect(await canvas.findByText(/moved "beautiful sunset" into collection/i)).toBeInTheDocument();
    const emptyFolderStrip = canvasElement.querySelector("[data-collection-id='nh-nest-col-c']") as HTMLElement;
    await expect(within(emptyFolderStrip).getByRole("button", { name: /beautiful sunset/i })).toBeInTheDocument();
  },
};

export const ConformanceNativeHtml5CollectionIntoCollection: Story = {
  render: () => <NestedCollectionsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="nh-nest-card-col-b"]') as HTMLElement;
    const emptyFolderCard = canvas.getByRole("button", { name: /empty folder/i });

    await simulateNativeDrag(handle, emptyFolderCard);

    await expect(await canvas.findByText(/moved "holiday folder" into collection/i)).toBeInTheDocument();
    const emptyFolderStrip = canvasElement.querySelector("[data-collection-id='nh-nest-col-c']") as HTMLElement;
    await expect(within(emptyFolderStrip).getByRole("button", { name: /holiday folder/i })).toBeInTheDocument();
  },
};

export const ConformanceNativeHtml5InvalidCycleRejected: Story = {
  render: () => <NestedCollectionsDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvasElement.querySelector('[data-reorder-handle="nh-nest-card-col-b"]') as HTMLElement;
    const tripSubfolderCard = canvas.getByRole("button", { name: /trip subfolder/i });

    await simulateNativeDrag(handle, tripSubfolderCard);

    await expect(
      await canvas.findByText(/cannot move a collection into itself or one of its nested collections/i)
    ).toBeInTheDocument();

    const rootStrip = canvasElement.querySelector("[data-collection-id='nh-nest-col-a']") as HTMLElement;
    await expect(within(rootStrip).getByRole("button", { name: /holiday folder/i })).toBeInTheDocument();
  },
};
