import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useMemo } from "react";
import { expect, userEvent, within, waitFor, spyOn } from "storybook/test";

import { MediaStrip } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { dndKitMediaStripDndAdapter } from "./adapters/dnd-kit-adapter";
import {
  trustedCollectionId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import {
  createImageTimelineItem,
  createVideoTimelineItem,
  createCollectionTimelineItem,
} from "./core/media-strip.validation";
import { unwrapResult, createThumbnail } from "./media-strip.stories-helpers";

// Content/layout edge cases: collection cards, missing/broken posters,
// very narrow/wide containers, unusual names, and fractional durations.
// Nested under "MediaStrip" alongside the other MediaStrip.*.stories.tsx
// files' groups in Storybook's sidebar (see each file's title).

const meta = {
  title: "UI/MediaStrip/MediaStrip/Edge Cases",
  // Single shared decorator — story-level decorators STACK with this one, so
  // per-story copies double-wrap the canvas (see VeryNarrowContainer/VeryWideContainer).
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

export const CollectionItems: Story = {
  render: () => {
    const [items, setItems] = useState<TimelineItem[]>(() => [
      unwrapResult(createImageTimelineItem({ id: "img-1", name: "Image Item", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
      unwrapResult(createCollectionTimelineItem({ id: "col-1", name: "Collection A", collectionId: "col-id-a", itemCount: 5, startTimeSeconds: 4, durationSeconds: 8 })),
      unwrapResult(createVideoTimelineItem({ id: "vid-1", name: "Video Item", src: "vid.mp4", sourceDurationSeconds: 20, trimInSeconds: 2, trimOutSeconds: 3, startTimeSeconds: 12 })),
      unwrapResult(createCollectionTimelineItem({ id: "col-2", name: "Collection B", collectionId: "col-id-b", itemCount: 12, startTimeSeconds: 27, durationSeconds: 10 })),
    ]);
    const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>([]);

    const handleMoveItem = useCallback(
      (command: TimelineItemCommand) => {
        if (command.type !== "move") return;
        const { itemId, toIndex } = command;
        const next = [...items];
        const idx = next.findIndex((i) => i.id === itemId);
        if (idx !== -1) {
          const [removed] = next.splice(idx, 1);
          next.splice(toIndex, 0, removed);
          setItems(next);
        }
      },
      [items]
    );

    const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Strips containing Collections", items }],
    ]), [items]);
    const visibleCollectionIds = useMemo(() => [trustedCollectionId("strip-1")], []);

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
        onMoveItem={handleMoveItem}
      >
        <MediaStrip
          collectionId={trustedCollectionId("strip-1")}
          heading="Strips containing Collections"
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
        />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Assert collection label matches itemCount formatting
    expect(canvas.getByText("Collection (5 items)")).toBeInTheDocument();
    expect(canvas.getByText("Collection (12 items)")).toBeInTheDocument();

    const firstItem = canvas.getByRole("button", { name: /collection a/i });
    firstItem.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(firstItem).toHaveAttribute("aria-pressed", "true");
    });
  },
};

export const VideoWithoutPoster: Story = {
  render: () => {
    const items = [
      unwrapResult(createVideoTimelineItem({
        id: "vid-1",
        name: "Dog Video",
        src: "dog.mp4",
        sourceDurationSeconds: 10,
        trimInSeconds: 0,
        trimOutSeconds: 0,
        startTimeSeconds: 0,
      })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Video without Poster", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Video without Poster" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const noPosterElements = canvas.getAllByText(/no poster/i);
    expect(noPosterElements.length).toBeGreaterThan(0);
    expect(canvasElement.querySelector("img")).toBeNull();
  },
};

export const MixedBrokenPosterSequence: Story = {
  render: () => {
    const items = [
      unwrapResult(createVideoTimelineItem({
        id: "vid-1",
        name: "Mixed Poster Sequence",
        src: "dog.mp4",
        sourceDurationSeconds: 20,
        trimInSeconds: 0,
        trimOutSeconds: 0,
        startTimeSeconds: 0,
        posterSrcs: [
          "https://invalid-url-broken-1.jpg",
          createThumbnail("#10b981", "Good 1"),
          "https://invalid-url-broken-2.jpg",
          createThumbnail("#3b82f6", "Good 2"),
        ],
      })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Mixed Poster Sequence", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Mixed Poster Sequence" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Wait to allow onError to fire asynchronously in the browser
    await waitFor(() => {
      // The broken URLs should fail and display "No poster" text for those slots,
      // while the good ones still display as images.
      const noPosterSlots = canvas.queryAllByText(/no poster/i);
      expect(noPosterSlots.length).toBeGreaterThan(0);
    });
  },
};

export const VeryNarrowContainer: Story = {
  render: () => {
    const items = [
      unwrapResult(createImageTimelineItem({ id: "item-1", name: "Short name", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
      unwrapResult(createImageTimelineItem({ id: "item-2", name: "Another short name", src: "img.png", startTimeSeconds: 4, durationSeconds: 4 })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Very Narrow", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Very Narrow" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="w-[280px] border border-red-500/25 p-2 rounded">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/very narrow/i)).toBeInTheDocument();
  },
};

export const VeryWideContainer: Story = {
  render: () => {
    const items = [
      unwrapResult(createImageTimelineItem({ id: "item-1", name: "Item 1", src: "img.png", startTimeSeconds: 0, durationSeconds: 40 })),
      unwrapResult(createImageTimelineItem({ id: "item-2", name: "Item 2", src: "img.png", startTimeSeconds: 40, durationSeconds: 40 })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Very Wide", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Very Wide" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="w-[1400px] border border-green-500/25 p-2 rounded">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/very wide/i)).toBeInTheDocument();
  },
};

export const LongNamesAndWeirdCharacters: Story = {
  render: () => {
    const items = [
      unwrapResult(createImageTimelineItem({ id: "item-1", name: "Really really really long clip name that should truncate gracefully", src: "img.png", startTimeSeconds: 0, durationSeconds: 10 })),
      unwrapResult(createImageTimelineItem({ id: "item-2", name: "Clip / Shot #004 — Café 🚗", src: "img.png", startTimeSeconds: 10, durationSeconds: 10 })),
      unwrapResult(createImageTimelineItem({ id: "item-3", name: "日本語 title", src: "img.png", startTimeSeconds: 20, durationSeconds: 10 })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Long Names & Characters", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Long Names & Characters" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Assert that clips are accessible by their exact names
    expect(canvas.getByRole("button", { name: /really really really long clip name/i })).toBeInTheDocument();
    expect(canvas.getByRole("button", { name: /clip \/ shot #004 — café/i })).toBeInTheDocument();
    expect(canvas.getByRole("button", { name: /日本語 title/i })).toBeInTheDocument();
  },
};

export const FractionalDurations: Story = {
  render: () => {
    const items = [
      unwrapResult(createImageTimelineItem({ id: "item-1", name: "Clip 1 (33ms)", src: "img.png", startTimeSeconds: 0, durationSeconds: 0.033 })),
      unwrapResult(createImageTimelineItem({ id: "item-2", name: "Clip 2 (0.5s)", src: "img.png", startTimeSeconds: 0.033, durationSeconds: 0.5 })),
      unwrapResult(createImageTimelineItem({ id: "item-3", name: "Clip 3 (1.25s)", src: "img.png", startTimeSeconds: 0.533, durationSeconds: 1.25 })),
      unwrapResult(createImageTimelineItem({ id: "item-4", name: "Clip 4 (59.999s)", src: "img.png", startTimeSeconds: 1.783, durationSeconds: 59.999 })),
      unwrapResult(createImageTimelineItem({ id: "item-5", name: "Clip 5 (3600.4s)", src: "img.png", startTimeSeconds: 61.782, durationSeconds: 3600.4 })),
    ];
    const collectionsById = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("strip-1"), { id: trustedCollectionId("strip-1"), name: "Fractional Durations", items }],
    ]);
    const visibleCollectionIds = [trustedCollectionId("strip-1")];

    return (
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={visibleCollectionIds}
      >
        <MediaStrip collectionId={trustedCollectionId("strip-1")} heading="Fractional Durations" selectedIds={[]} onSelectionChange={() => { }} />
      </MediaStripBoard>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/fractional durations/i)).toBeInTheDocument();
  },
};

// --- Dev-time validateProjectTimeline warning ---

function ValidatesGraphInDevBoard() {
  const validCollections = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("edge-validate-root"), {
      id: trustedCollectionId("edge-validate-root"),
      name: "Root",
      items: [
        unwrapResult(createImageTimelineItem({
          id: "edge-validate-img-1",
          name: "Item",
          src: "img.png",
          startTimeSeconds: 0,
          durationSeconds: 4,
        })),
      ],
    }],
  ]), []);

  // Two items sharing an id across the graph: itemLookup is a Map keyed by
  // item id, so the second one silently overwrites the first's entry — a
  // real corruption, not a lazy-loading artifact. validateProjectTimeline
  // reports this as "duplicate-global-item-ids".
  const duplicateIdCollections = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("edge-validate-root"), {
      id: trustedCollectionId("edge-validate-root"),
      name: "Root",
      items: [
        unwrapResult(createImageTimelineItem({
          id: "edge-validate-img-1",
          name: "First",
          src: "img.png",
          startTimeSeconds: 0,
          durationSeconds: 4,
        })),
        unwrapResult(createImageTimelineItem({
          id: "edge-validate-img-1",
          name: "Second (duplicate id)",
          src: "img.png",
          startTimeSeconds: 4,
          durationSeconds: 4,
        })),
      ],
    }],
  ]), []);

  // A CollectionTimelineItem whose backing collection isn't in
  // collectionsById yet — the expected shape for a lazily-loaded app (a
  // collection card can render from its own itemCount before its contents
  // are fetched). This must NOT warn: it doesn't corrupt itemLookup or
  // parentByCollectionId the way the duplicate-id case does.
  const lazyUnloadedCollections = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("edge-validate-root"), {
      id: trustedCollectionId("edge-validate-root"),
      name: "Root",
      items: [
        unwrapResult(createCollectionTimelineItem({
          id: "edge-validate-dangling-card",
          name: "Not-Yet-Loaded Folder",
          collectionId: trustedCollectionId("edge-validate-missing"),
          itemCount: 3,
          startTimeSeconds: 0,
          durationSeconds: 5,
        })),
      ],
    }],
  ]), []);

  const [collectionsById, setCollectionsById] = useState(validCollections);

  return (
    <>
      <button type="button" onClick={() => setCollectionsById(duplicateIdCollections)}>
        Corrupt graph (duplicate ids)
      </button>
      <button type="button" onClick={() => setCollectionsById(lazyUnloadedCollections)}>
        Load lazily-unloaded collection
      </button>
      <MediaStripBoard
        collectionsById={collectionsById}
        dndAdapter={dndKitMediaStripDndAdapter}
        visibleCollectionIds={[trustedCollectionId("edge-validate-root")]}
      >
        <MediaStrip
          collectionId={trustedCollectionId("edge-validate-root")}
          heading="Root"
          selectedIds={[]}
          onSelectionChange={() => { }}
        />
      </MediaStripBoard>
    </>
  );
}

export const InvalidGraphWarnsInDev: Story = {
  render: () => <ValidatesGraphInDevBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => { });

    try {
      await userEvent.click(canvas.getByRole("button", { name: /corrupt graph \(duplicate ids\)/i }));

      await waitFor(() => {
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("duplicate-global-item-ids"),
          expect.objectContaining({ valid: false, reason: "duplicate-global-item-ids" })
        );
      });
    } finally {
      warnSpy.mockRestore();
    }
  },
};

export const LazilyUnloadedCollectionDoesNotWarn: Story = {
  render: () => <ValidatesGraphInDevBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => { });

    try {
      await userEvent.click(canvas.getByRole("button", { name: /load lazily-unloaded collection/i }));
      await expect(await canvas.findByText(/not-yet-loaded folder/i)).toBeInTheDocument();

      const validateProjectTimelineCalls = warnSpy.mock.calls.filter(([message]) =>
        typeof message === "string" && message.includes("validateProjectTimeline")
      );
      expect(validateProjectTimelineCalls).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  },
};
