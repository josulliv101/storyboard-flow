import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useEffect, useMemo } from "react";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";

import { MediaStrip, type MediaStripProps, type MediaStripSelection } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import {
  asTimelineItemId,
  type TimelineItem,
  type TimelineItemId,
  type TimelineItemResult,
  type MediaStripMove,
} from "./media-strip.types";
import {
  createImageTimelineItem,
  createVideoTimelineItem,
  createCollectionTimelineItem,
} from "./media-strip.validation";

function unwrapResult<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Failed to construct timeline item: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

type StoryMediaItem = {
  id: string;
  title: string;
  duration: string;
} & (
    | {
      kind: "image";
      thumbnailUrl: string;
    }
    | {
      kind: "video";
      videoSrc: string;
      thumbnailTime: "00:02" | "00:04";
      thumbnailUrl: string;
    }
  );

const storyVideoSrc = new URL("./fixtures/dog.mp4", import.meta.url).href;
const dogVideoThumbnails = {
  "00:02": new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  "00:04": new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
} satisfies Record<string, string>;

const createThumbnail = (color: string, label: string) =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" rx="18" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="white" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;

const createPhotoThumbnail = (seed: string) =>
  createThumbnail(
    `#${Array.from(seed)
      .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 0xffffff, 0)
      .toString(16)
      .padStart(6, "0")}`,
    seed
      .split("-")
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join(""),
  );

function durationToSeconds(duration: string) {
  const [minutes = "0", seconds = "0"] = duration.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function toTimelineItem(item: StoryMediaItem): TimelineItem {
  const idResult = asTimelineItemId(item.id);
  if (!idResult.ok) {
    throw new Error(`Failed to parse timeline item ID: ${item.id}`);
  }
  const id = idResult.value;
  const seconds = durationToSeconds(item.duration);

  if (item.kind === "video") {
    const result = createVideoTimelineItem({
      id,
      name: item.title,
      src: item.videoSrc,
      posterSrcs: [item.thumbnailUrl],
      startTimeSeconds: 0,
      sourceDurationSeconds: seconds + 10,
      trimInSeconds: 5,
      trimOutSeconds: 5,
    });
    if (result.ok) return result.value;
    throw new Error(`Failed to create video timeline item: ${result.error.reason}`);
  } else {
    const result = createImageTimelineItem({
      id,
      name: item.title,
      src: item.thumbnailUrl,
      posterSrcs: [item.thumbnailUrl],
      startTimeSeconds: 0,
      durationSeconds: seconds,
    });
    if (result.ok) return result.value;
    throw new Error(`Failed to create image timeline item: ${result.error.reason}`);
  }
}

const items: StoryMediaItem[] = [
  {
    id: "wide",
    kind: "image",
    title: "Opening Wide",
    duration: "00:04",
    thumbnailUrl: createPhotoThumbnail("opening-wide"),
  },
  {
    id: "close",
    kind: "image",
    title: "Character Closeup",
    duration: "00:05",
    thumbnailUrl: createPhotoThumbnail("character-closeup"),
  },
  {
    id: "insert",
    kind: "image",
    title: "Insert Detail",
    duration: "00:02",
    thumbnailUrl: createPhotoThumbnail("insert-detail"),
  },
  {
    id: "dog-tracking",
    kind: "video",
    title: "Dog Tracking Shot",
    videoSrc: storyVideoSrc,
    thumbnailTime: "00:02",
    thumbnailUrl: dogVideoThumbnails["00:02"],
    duration: "00:03",
  },
  {
    id: "dog-exit",
    kind: "video",
    title: "Dog Exit",
    videoSrc: storyVideoSrc,
    thumbnailTime: "00:04",
    thumbnailUrl: dogVideoThumbnails["00:04"],
    duration: "00:06",
  },
  {
    id: "cutaway-10",
    kind: "image",
    title: "Reaction Cutaway",
    duration: "00:10",
    thumbnailUrl: createPhotoThumbnail("reaction-cutaway"),
  },
  {
    id: "dog-exit-2",
    kind: "video",
    title: "Dog Again",
    videoSrc: storyVideoSrc,
    thumbnailTime: "00:04",
    thumbnailUrl: dogVideoThumbnails["00:04"],
    duration: "00:16",
  },
];

const mediaItems = items.map(toTimelineItem);
const repeatedThumbnail = createThumbnail("#475569", "Repeat");

const createImg = (id: string, name: string, color: string, duration: number) => {
  const thumb = createThumbnail(color, name);
  const idResult = asTimelineItemId(id);
  if (!idResult.ok) throw new Error("Constructor error: invalid ID");

  const result = createImageTimelineItem({
    id: idResult.value,
    name,
    src: thumb,
    posterSrcs: [thumb],
    startTimeSeconds: 0,
    durationSeconds: duration,
  });
  if (!result.ok) throw new Error("Constructor error");
  return result.value;
};

const shortAndLongItems: TimelineItem[] = [
  createImg("clip-short", "Flash Insert", "#0891b2", 1),
  createImg("clip-long", "Extended Walkthrough", "#9333ea", 135),
  createImg("clip-trimmed", "Trimmed Dialogue", "#ea580c", 9),
];

const manyItems = Array.from({ length: 3 }, () => items)
  .flat()
  .map((item, index) => {
    const nextId = `${item.id}-${index + 1}`;
    return toTimelineItem({
      ...item,
      id: nextId,
      title: `${item.title} ${index + 1}`,
    });
  });

function StatefulMediaStrip(props: MediaStripProps) {
  const [items, setItems] = useState<TimelineItem[]>(() => props.items || []);
  const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>(() => props.selectedIds || []);

  useEffect(() => {
    setItems(props.items || []);
  }, [props.items]);

  useEffect(() => {
    setSelectedIds(props.selectedIds || []);
  }, [props.selectedIds]);

  const handleMoveItem = useCallback(
    ({ itemId, fromIndex, toIndex }: MediaStripMove) => {
      setItems((prev) => {
        const next = [...prev];
        const index = next.findIndex((i) => i.id === itemId);
        if (index === -1) return prev;
        const [moved] = next.splice(index, 1);
        const clampedIndex = Math.max(0, Math.min(toIndex, next.length));
        next.splice(clampedIndex, 0, moved);
        return next;
      });
    },
    []
  );

  const handleSelectionChange = useCallback(
    (selection: MediaStripSelection) => {
      setSelectedIds(selection.selectedIds);
      props.onSelectionChange?.(selection);
    },
    [props.onSelectionChange]
  );

  const stripId = props.stripId || "default-strip";
  const itemsByStripId = useMemo(() => ({ [stripId]: items }), [stripId, items]);

  return (
    <MediaStripBoard itemsByStripId={itemsByStripId} onMoveItem={handleMoveItem}>
      <MediaStrip
        {...props}
        items={items}
        selectedIds={selectedIds}
        onMoveItem={handleMoveItem}
        onSelectionChange={handleSelectionChange}
      />
    </MediaStripBoard>
  );
}

const meta = {
  title: "UI/MediaStrip/MediaStrip",
  component: StatefulMediaStrip,
  args: {
    onAction: fn(),
    onSelectionChange: fn(),
    items: mediaItems,
    selectedIds: ["close" as TimelineItemId],
    heading: "Scene media",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof StatefulMediaStrip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Starter: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /insert detail/i }),
    );

    await expect(args.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining(["insert" as TimelineItemId]),
      }),
    );
  },
};

export const SelectedState: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /character closeup/i }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const KeyboardSelection: Story = {
  args: {
    selectedIds: ["wide" as TimelineItemId],
  },
  play: async ({ args, canvas, canvasElement }) => {
    const firstClip = canvas.getByRole("button", { name: /opening wide/i });

    firstClip.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");

    await expect(canvasElement.ownerDocument.activeElement).toBe(
      canvas.getByRole("button", { name: /character closeup/i }),
    );
    await expect(args.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining(["close" as TimelineItemId]),
      }),
    );
  },
};

export const Empty: Story = {
  args: {
    items: [],
    selectedIds: [],
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /add media/i }));

    await expect(args.onAction).toHaveBeenCalled();
  },
};

export const MissingPosterFallback: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: "clip-missing" as TimelineItemId,
          name: "Offline Poster",
          src: "https://example.com/offline-media.jpg",
          startTimeSeconds: 0,
          durationSeconds: 8,
        })
      ),
      mediaItems[0],
      mediaItems[1],
    ],
    selectedIds: ["clip-missing" as TimelineItemId],
  },
};

export const RepeatedThumbnails: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: "repeat-1" as TimelineItemId,
          name: "Take One",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "repeat-2" as TimelineItemId,
          name: "Take Two",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "repeat-3" as TimelineItemId,
          name: "Take Three",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
    ],
    selectedIds: ["repeat-2" as TimelineItemId],
    pxPerSecond: 80,
  },
};

export const SingleImageThumbnails: Story = {
  args: {
    thumbnailVariant: "single",
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: "single-1" as TimelineItemId,
          name: "Take One (Single Image)",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "single-2" as TimelineItemId,
          name: "Take Two (Single Image)",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
    ],
    selectedIds: ["single-1" as TimelineItemId],
  },
};

export const SequenceOfDifferentImages: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: "seq-diff-1" as TimelineItemId,
          name: "Short Clip (3s)",
          src: createThumbnail("#b91c1c", "Frame 1"),
          posterSrcs: [
            createThumbnail("#b91c1c", "Frame 1"),
            createThumbnail("#d97706", "Frame 2"),
            createThumbnail("#059669", "Frame 3"),
            createThumbnail("#2563eb", "Frame 4"),
          ],
          startTimeSeconds: 0,
          durationSeconds: 3,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "seq-diff-2" as TimelineItemId,
          name: "Medium Clip (6s)",
          src: createThumbnail("#b91c1c", "Frame 1"),
          posterSrcs: [
            createThumbnail("#b91c1c", "Frame 1"),
            createThumbnail("#d97706", "Frame 2"),
            createThumbnail("#059669", "Frame 3"),
            createThumbnail("#2563eb", "Frame 4"),
          ],
          startTimeSeconds: 3,
          durationSeconds: 6,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "seq-diff-3" as TimelineItemId,
          name: "Long Clip (9s)",
          src: createThumbnail("#b91c1c", "Frame 1"),
          posterSrcs: [
            createThumbnail("#b91c1c", "Frame 1"),
            createThumbnail("#d97706", "Frame 2"),
            createThumbnail("#059669", "Frame 3"),
            createThumbnail("#2563eb", "Frame 4"),
          ],
          startTimeSeconds: 9,
          durationSeconds: 9,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "seq-diff-4" as TimelineItemId,
          name: "Max Width Clip (12s)",
          src: createThumbnail("#b91c1c", "Frame 1"),
          posterSrcs: [
            createThumbnail("#b91c1c", "Frame 1"),
            createThumbnail("#d97706", "Frame 2"),
            createThumbnail("#059669", "Frame 3"),
            createThumbnail("#2563eb", "Frame 4"),
          ],
          startTimeSeconds: 18,
          durationSeconds: 12,
        })
      ),
    ],
    selectedIds: ["seq-diff-2" as TimelineItemId],
  },
};

export const ShortLongAndTrimmedClips: Story = {
  args: {
    items: shortAndLongItems,
    selectedIds: ["clip-trimmed" as TimelineItemId],
  },
};

export const ManyItemTimeline: Story = {
  args: {
    items: manyItems,
    selectedIds: ["cutaway-10" as TimelineItemId],
    heading: "Timeline media",
  },
  play: async ({ canvasElement }) => {
    const viewport = canvasElement.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    const dragSurface = canvasElement.querySelector<HTMLElement>(
      '[data-testid^="media-strip-drag-scroll"]',
    );
    const thumbnails = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        '[data-slot="media-strip-thumbnail"]',
      ),
    );

    await expect(viewport).not.toBeNull();
    await expect(dragSurface).not.toBeNull();
    await expect(thumbnails.length).toBeGreaterThan(0);
    await expect(viewport?.scrollWidth).toBeGreaterThan(
      viewport?.clientWidth ?? 0,
    );

    const firstThumbnailHeight = Math.round(
      thumbnails[0]?.getBoundingClientRect().height ?? 0,
    );

    for (const thumbnail of thumbnails) {
      await expect(Math.round(thumbnail.getBoundingClientRect().height)).toBe(
        firstThumbnailHeight,
      );
    }

    if (viewport) {
      viewport.scrollLeft = 240;
      await expect(viewport.scrollLeft).toBeGreaterThan(0);
    }

    await expect(dragSurface).toHaveClass(/cursor-grab/);
  },
};

export const MultipleSelectionInitial: Story = {
  args: {
    selectedIds: ["wide" as TimelineItemId, "close" as TimelineItemId],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /opening wide/i }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      canvas.getByRole("button", { name: /character closeup/i }),
    ).toHaveAttribute("aria-pressed", "true");
  },
};

export const MultipleSelectionToggle: Story = {
  args: {
    selectedIds: ["wide" as TimelineItemId],
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /character closeup/i }),
    );

    await expect(args.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining([
          "wide" as TimelineItemId,
          "close" as TimelineItemId,
        ]),
      }),
    );
  },
};

export const BrokenPosterFallback: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: "clip-broken" as TimelineItemId,
          name: "Broken Link Poster",
          src: "https://example.com/broken-image.jpg",
          posterSrcs: ["https://example.com/broken-image.jpg"],
          startTimeSeconds: 0,
          durationSeconds: 6,
        })
      ),
      mediaItems[0],
    ],
    selectedIds: ["clip-broken" as TimelineItemId],
  },
};

export const KeyboardVirtualNavigation: Story = {
  args: {
    selectedIds: ["wide" as TimelineItemId],
  },
  play: async ({ args, canvas, canvasElement }) => {
    const firstClip = canvas.getByRole("button", { name: /opening wide/i });

    firstClip.focus();
    // Navigate past the visible viewport bounds by pressing ArrowRight multiple times
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");

    // Press Enter to select the now-focused unmounted item
    await userEvent.keyboard("{Enter}");

    const targetClip = canvas.getByRole("button", { name: /reaction cutaway/i });

    await expect(canvasElement.ownerDocument.activeElement).toBe(targetClip);
    await expect(args.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining(["cutaway-10" as TimelineItemId]),
      }),
    );
  },
};

const ReorderDemo = () => {
  const [stripA, setStripA] = useState<TimelineItem[]>(() => [
    unwrapResult(
      createImageTimelineItem({
        id: "item-a1" as TimelineItemId,
        name: "Item A1",
        src: createThumbnail("#f43f5e", "A1"),
        startTimeSeconds: 0,
        durationSeconds: 5,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-a2" as TimelineItemId,
        name: "Item A2",
        src: createThumbnail("#ec4899", "A2"),
        startTimeSeconds: 0,
        durationSeconds: 6,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-a3" as TimelineItemId,
        name: "Item A3",
        src: createThumbnail("#d946ef", "A3"),
        startTimeSeconds: 0,
        durationSeconds: 4,
      })
    ),
  ]);

  const [stripB, setStripB] = useState<TimelineItem[]>(() => [
    unwrapResult(
      createImageTimelineItem({
        id: "item-b1" as TimelineItemId,
        name: "Item B1",
        src: createThumbnail("#3b82f6", "B1"),
        startTimeSeconds: 0,
        durationSeconds: 5,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-b2" as TimelineItemId,
        name: "Item B2",
        src: createThumbnail("#06b6d4", "B2"),
        startTimeSeconds: 0,
        durationSeconds: 7,
      })
    ),
  ]);

  const [stripC, setStripC] = useState<TimelineItem[]>(() => [
    unwrapResult(
      createImageTimelineItem({
        id: "item-c1" as TimelineItemId,
        name: "Item C1",
        src: createThumbnail("#10b981", "C1"),
        startTimeSeconds: 0,
        durationSeconds: 4,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c2" as TimelineItemId,
        name: "Item C2",
        src: createThumbnail("#059669", "C2"),
        startTimeSeconds: 0,
        durationSeconds: 5,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c3" as TimelineItemId,
        name: "Item C3",
        src: createThumbnail("#047857", "C3"),
        startTimeSeconds: 0,
        durationSeconds: 3,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c4" as TimelineItemId,
        name: "Item C4",
        src: createThumbnail("#14b8a6", "C4"),
        startTimeSeconds: 0,
        durationSeconds: 6,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c5" as TimelineItemId,
        name: "Item C5",
        src: createThumbnail("#0db9e8", "C5"),
        startTimeSeconds: 0,
        durationSeconds: 8,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c6" as TimelineItemId,
        name: "Item C6",
        src: createThumbnail("#f59e0b", "C6"),
        startTimeSeconds: 0,
        durationSeconds: 5,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c7" as TimelineItemId,
        name: "Item C7",
        src: createThumbnail("#d97706", "C7"),
        startTimeSeconds: 0,
        durationSeconds: 7,
      })
    ),
    unwrapResult(
      createImageTimelineItem({
        id: "item-c8" as TimelineItemId,
        name: "Item C8",
        src: createThumbnail("#b45309", "C8"),
        startTimeSeconds: 0,
        durationSeconds: 4,
      })
    ),
  ]);

  const [selectedIds, setSelectedIds] = useState<TimelineItemId[]>([]);

  const handleMoveItem = useCallback(
    ({
      itemId,
      fromStripId,
      toStripId,
      fromIndex,
      toIndex,
    }: MediaStripMove) => {
      let itemToMove: TimelineItem | undefined;
      let nextStripA = [...stripA];
      let nextStripB = [...stripB];
      let nextStripC = [...stripC];

      if (fromStripId === "strip-a") {
        const index = nextStripA.findIndex((i) => i.id === itemId);
        if (index !== -1) {
          [itemToMove] = nextStripA.splice(index, 1);
        }
      } else if (fromStripId === "strip-b") {
        const index = nextStripB.findIndex((i) => i.id === itemId);
        if (index !== -1) {
          [itemToMove] = nextStripB.splice(index, 1);
        }
      } else {
        const index = nextStripC.findIndex((i) => i.id === itemId);
        if (index !== -1) {
          [itemToMove] = nextStripC.splice(index, 1);
        }
      }

      if (!itemToMove) return;

      if (toStripId === "strip-a") {
        const clampedIndex = Math.max(0, Math.min(toIndex, nextStripA.length));
        nextStripA.splice(clampedIndex, 0, itemToMove);
      } else if (toStripId === "strip-b") {
        const clampedIndex = Math.max(0, Math.min(toIndex, nextStripB.length));
        nextStripB.splice(clampedIndex, 0, itemToMove);
      } else {
        const clampedIndex = Math.max(0, Math.min(toIndex, nextStripC.length));
        nextStripC.splice(clampedIndex, 0, itemToMove);
      }

      setStripA(nextStripA);
      setStripB(nextStripB);
      setStripC(nextStripC);
    },
    [stripA, stripB, stripC]
  );

  const itemsByStripId = {
    "strip-a": stripA,
    "strip-b": stripB,
    "strip-c": stripC,
  };

  return (
    <MediaStripBoard itemsByStripId={itemsByStripId} onMoveItem={handleMoveItem}>
      <div className="flex flex-col gap-8 p-4 bg-zinc-950 rounded-lg">
        <div>
          <p className="text-sm text-zinc-400 mb-2">
            Pointer instructions: Drag item from its grab handle (six dots) in the top-right and hover over target areas or empty strips.
            <br />
            Keyboard instructions: Focus the grab handle, press Enter or Space to activate Reorder Mode.
            Use ArrowLeft/Right to reorder, ArrowUp/Down to move between strips, Escape to cancel.
          </p>
        </div>
        <MediaStrip
          stripId="strip-a"
          heading="Media Strip A (Red/Pink)"
          items={stripA}
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
          onMoveItem={handleMoveItem}
        />
        <MediaStrip
          stripId="strip-b"
          heading="Media Strip B (Blue/Cyan)"
          items={stripB}
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
          onMoveItem={handleMoveItem}
        />
        <MediaStrip
          stripId="strip-c"
          heading="Media Strip C (Green/Emerald with Lots of Items)"
          items={stripC}
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
          onMoveItem={handleMoveItem}
        />
      </div>
    </MediaStripBoard>
  );
};

export const ReorderableMediaStrips: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
};

const waitForLayout = async (element: HTMLElement) => {
  await waitFor(() => {
    const rect = element.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
};

// Helper functions for programmatic PointerEvent simulation in headless story tests
const simulatePointerDrag = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // 1. Pointer Down
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: startRect.left + 5,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  // 2. Drag slightly to trigger dnd-kit pointer sensor activation constraint (> 5px)
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: startRect.left + 20,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  // 3. Drag to target
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  // 4. Release mouse button (Pointer Up)
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
      isPrimary: true,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
};

const simulateDragOscillation = async (handle: HTMLElement, target: HTMLElement) => {
  await waitForLayout(handle);
  await waitForLayout(target);

  const startRect = handle.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // 1. Pointer Down
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: startRect.left + 5,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  // 2. Move past threshold
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: startRect.left + 20,
      clientY: startRect.top + 5,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // 3. Move to target
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  // 4. Oscillate back and forth to trigger multiple collision detection runs
  for (let i = 0; i < 5; i++) {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: targetRect.left + targetRect.width / 2 + (i % 2 === 0 ? 5 : -5),
        clientY: targetRect.top + targetRect.height / 2,
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  // 5. Pointer Up
  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: targetRect.left + targetRect.width / 2,
      clientY: targetRect.top + targetRect.height / 2,
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));
};

const simulateScrollAreaDrag = async (scrollArea: HTMLElement) => {
  await waitForLayout(scrollArea);

  const rect = scrollArea.getBoundingClientRect();

  scrollArea.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: rect.left + 100,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: rect.left + 50,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  document.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: rect.left + 50,
      clientY: rect.top + 50,
      bubbles: true,
      button: 0,
      buttons: 1,
      pointerId: 1,
    })
  );
};

export const MultiStripDragRegression: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    // Locate the first item reorder handle in the DOM
    const firstHandle = canvasElement.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvasElement.querySelector("[data-strip-id='strip-b'] [data-value]") as HTMLElement;
    if (!firstHandle || !targetItem) return;

    await simulateDragOscillation(firstHandle, targetItem);
  },
};

export const KeyboardReorderWithinStrip: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard(" ");

    // Reorder right: moves from index 0 -> index 1
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText(/moved "item a1" to position 2/i)).toBeInTheDocument();

    // Reorder left: moves from index 1 -> index 0
    await userEvent.keyboard("{ArrowLeft}");
    await expect(await canvas.findByText(/moved "item a1" to position 1/i)).toBeInTheDocument();

    // Drop
    await userEvent.keyboard(" ");
    await expect(await canvas.findByText(/dropped "item a1" at position 1/i)).toBeInTheDocument();
  },
};

export const KeyboardReorderBetweenStrips: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Reorder down to Strip B
    await userEvent.keyboard("{ArrowDown}");
    await expect(await canvas.findByText(/moved "item a1" to strip "strip-b" at position/i)).toBeInTheDocument();
  },
};

export const KeyboardReorderCancel: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Move to position 2
    await userEvent.keyboard("{ArrowRight}");
    await expect(await canvas.findByText(/moved "item a1" to position 2/i)).toBeInTheDocument();

    // Cancel reorder using Escape, reverting the move
    await userEvent.keyboard("{Escape}");
    await expect(await canvas.findByText(/dropped "item a1" at position 1/i)).toBeInTheDocument();
  },
};

export const PointerDragWithinStrip: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const secondItem = canvas.getByRole("button", { name: /item a2/i });

    // Drag horizontally to index 1 over Item A2 using programmatic pointer events
    await simulatePointerDrag(handle, secondItem);

    await expect(await canvas.findByText(/dropped "item a1" at position/i)).toBeInTheDocument();
  },
};

export const PointerDragBetweenStrips: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const container = firstItem.closest("[data-testid^='media-strip-']") as HTMLElement;
    const handle = container.querySelector("[data-reorder-handle]") as HTMLElement;
    const targetItem = canvas.getByRole("button", { name: /item b1/i });

    // Drag vertically down to Strip B over Item B1 using programmatic pointer events
    await simulatePointerDrag(handle, targetItem);

    await expect(await canvas.findByText(/dropped "item a1" at position/i)).toBeInTheDocument();
  },
};

export const PointerDragIntoEmptyStrip: Story = {
  render: () => {
    const [stripA, setStripA] = useState<TimelineItem[]>([
      unwrapResult(
        createImageTimelineItem({
          id: "item-1",
          name: "Item 1",
          src: "img.png",
          startTimeSeconds: 0,
          durationSeconds: 4,
        })
      ),
    ]);
    const [stripB, setStripB] = useState<TimelineItem[]>([]);

    const handleMoveItem = useCallback(
      ({ itemId, toStripId }: MediaStripMove) => {
        const item = stripA.find((i) => i.id === itemId);
        if (item && toStripId === "strip-b") {
          setStripB([item]);
          setStripA([]);
        }
      },
      [stripA]
    );

    return (
      <MediaStripBoard itemsByStripId={{ "strip-a": stripA, "strip-b": stripB }} onMoveItem={handleMoveItem}>
        <div className="flex flex-col gap-8 p-4">
          <MediaStrip stripId="strip-a" heading="Strip A" items={stripA} selectedIds={[]} onSelectionChange={() => {}} />
          <MediaStrip stripId="strip-b" heading="Strip B" items={stripB} selectedIds={[]} onSelectionChange={() => {}} />
        </div>
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item 1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;
    const emptyDroppable = canvasElement.querySelector("[data-strip-id='strip-b'] .border-dashed") as HTMLElement;

    // Drag down to empty Strip B droppable container using programmatic pointer events
    await simulatePointerDrag(handle, emptyDroppable);

    await waitFor(() => {
      const stripB = canvasElement.querySelector("[data-strip-id='strip-b']") as HTMLElement;
      expect(within(stripB).queryByText(/no media items yet/i)).not.toBeInTheDocument();
      expect(within(stripB).getByRole("button", { name: /item 1/i })).toBeInTheDocument();
    });
  },
};

export const SelectedItemRemainsSelected: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });

    // Select the first item by focusing it and pressing Enter
    firstItem.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(firstItem).toHaveAttribute("aria-pressed", "true");
    });

    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;
    handle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");

    // Assert that the item remains selected after reordering
    const movedItem = await canvas.findByRole("button", { name: /item a1/i });
    await waitFor(() => {
      expect(movedItem).toHaveAttribute("aria-pressed", "true");
    });
  },
};

export const DraggingScrollAreaDoesNotSelect: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollArea = canvasElement.querySelector("[data-testid^='media-strip-drag-scroll-']") as HTMLElement;

    // Perform a pointer drag on the scroll area background to scroll it using programmatic pointer events
    await simulateScrollAreaDrag(scrollArea);

    // Assert that selection remains unchanged
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    await expect(firstItem).not.toHaveAttribute("aria-pressed", "true");
  },
};

export const ReorderHandleArrowKeysDoNotNavigate: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Focus the reorder handle
    handle.focus();

    // Press ArrowRight (WITHOUT entering reorder mode first)
    await userEvent.keyboard("{ArrowRight}");

    // Focus should remain on the handle, NOT jump to the next item
    await expect(canvasElement.ownerDocument.activeElement).toBe(handle);
  },
};

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
      ({ itemId, toIndex }: MediaStripMove) => {
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

    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }} onMoveItem={handleMoveItem}>
        <MediaStrip
          stripId="strip-1"
          heading="Strips containing Collections"
          items={items}
          selectedIds={selectedIds}
          onSelectionChange={(s) => setSelectedIds(s.selectedIds)}
        />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Video without Poster" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Mixed Poster Sequence" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Very Narrow" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="w-[280px] border border-red-500/25 p-2 rounded">
          <Story />
        </div>
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Very Wide" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="w-[1400px] border border-green-500/25 p-2 rounded">
          <Story />
        </div>
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Long Names & Characters" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
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
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="Fractional Durations" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText(/fractional durations/i)).toBeInTheDocument();
  },
};

export const ThousandsOfItemsVirtualized: Story = {
  render: () => {
    const items = useMemo(() => {
      return Array.from({ length: 1000 }).map((_, i) =>
        unwrapResult(
          createImageTimelineItem({
            id: `item-${i}`,
            name: `Item ${i}`,
            src: "img.png",
            startTimeSeconds: i * 4,
            durationSeconds: 4,
          })
        )
      );
    }, []);
    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }}>
        <MediaStrip stripId="strip-1" heading="1,000 Virtualized Items" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const scrollArea = canvasElement.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;
    const buttons = canvasElement.querySelectorAll("[data-testid^='media-strip-item-']");

    // Virtualized viewport should only render visible items (<100)
    expect(buttons.length).toBeLessThan(100);

    // Scroll container dimensions should verify horizontal overflow
    expect(scrollArea.scrollWidth).toBeGreaterThan(scrollArea.clientWidth);
  },
};

export const MultipleBoardsOnPage: Story = {
  render: () => {
    const [board1A, setBoard1A] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-1a", name: "Item 1A", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board1B, setBoard1B] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-1b", name: "Item 1B", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board2A, setBoard2A] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-2a", name: "Item 2A", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);
    const [board2B, setBoard2B] = useState<TimelineItem[]>([
      unwrapResult(createImageTimelineItem({ id: "item-2b", name: "Item 2B", src: "img.png", startTimeSeconds: 0, durationSeconds: 4 })),
    ]);

    const handleMove1 = useCallback(({ itemId, toStripId, toIndex }: MediaStripMove) => {
      const all = { "strip-1a": board1A, "strip-1b": board1B };
      const fromStripId = board1A.some(i => i.id === itemId) ? "strip-1a" : "strip-1b";
      const item = all[fromStripId].find(i => i.id === itemId)!;

      if (fromStripId === "strip-1a") {
        setBoard1A(board1A.filter(i => i.id !== itemId));
      } else {
        setBoard1B(board1B.filter(i => i.id !== itemId));
      }

      if (toStripId === "strip-1a") {
        const next = [...board1A.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard1A(next);
      } else {
        const next = [...board1B.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard1B(next);
      }
    }, [board1A, board1B]);

    const handleMove2 = useCallback(({ itemId, toStripId, toIndex }: MediaStripMove) => {
      const fromStripId = board2A.some(i => i.id === itemId) ? "strip-2a" : "strip-2b";
      const item = (fromStripId === "strip-2a" ? board2A : board2B).find(i => i.id === itemId)!;

      if (fromStripId === "strip-2a") {
        setBoard2A(board2A.filter(i => i.id !== itemId));
      } else {
        setBoard2B(board2B.filter(i => i.id !== itemId));
      }

      if (toStripId === "strip-2a") {
        const next = [...board2A.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard2A(next);
      } else {
        const next = [...board2B.filter(i => i.id !== itemId)];
        next.splice(toIndex, 0, item);
        setBoard2B(next);
      }
    }, [board2A, board2B]);

    return (
      <div className="flex flex-col gap-12">
        <div className="border p-4 rounded-lg bg-card">
          <h3 className="text-sm font-bold mb-2">Board 1</h3>
          <MediaStripBoard itemsByStripId={{ "strip-1a": board1A, "strip-1b": board1B }} onMoveItem={handleMove1}>
            <div className="flex flex-col gap-4">
              <MediaStrip stripId="strip-1a" heading="Strip 1A" items={board1A} selectedIds={[]} onSelectionChange={() => {}} />
              <MediaStrip stripId="strip-1b" heading="Strip 1B" items={board1B} selectedIds={[]} onSelectionChange={() => {}} />
            </div>
          </MediaStripBoard>
        </div>
        <div className="border p-4 rounded-lg bg-card">
          <h3 className="text-sm font-bold mb-2">Board 2</h3>
          <MediaStripBoard itemsByStripId={{ "strip-2a": board2A, "strip-2b": board2B }} onMoveItem={handleMove2}>
            <div className="flex flex-col gap-4">
              <MediaStrip stripId="strip-2a" heading="Strip 2A" items={board2A} selectedIds={[]} onSelectionChange={() => {}} />
              <MediaStrip stripId="strip-2b" heading="Strip 2B" items={board2B} selectedIds={[]} onSelectionChange={() => {}} />
            </div>
          </MediaStripBoard>
        </div>
      </div>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const item1B = canvas.getByRole("button", { name: /item 1b/i });
    const handle = item1B.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Pick up item 1B
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Press ArrowDown. Since Board 1 has strip-1b at the bottom, it should be blocked from going into Board 2.
    await userEvent.keyboard("{ArrowDown}");

    // Assert announcement was "Already at the bottom strip." immediately after arrow key press
    const announcer = canvasElement.ownerDocument.body.querySelector("[aria-live='polite']") as HTMLElement;
    expect(announcer.textContent).toContain("Already at the bottom strip.");

    // Press Enter to confirm drop and clean up
    await userEvent.keyboard("{Enter}");
  },
};

export const KeyboardReorderBoundaryAnnouncements: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Focus and activate reorder
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // 1. Move Left at first item
    await userEvent.keyboard("{ArrowLeft}");
    const announcer = canvasElement.ownerDocument.body.querySelector("[aria-live='polite']") as HTMLElement;
    expect(announcer.textContent).toContain("Already first in strip.");

    // 2. Move Up at top strip
    await userEvent.keyboard("{ArrowUp}");
    expect(announcer.textContent).toContain("Already at the top strip.");

    // Confirm reorder
    await userEvent.keyboard("{Enter}");
  },
};

export const EscapeCancelAcrossStrips: Story = {
  render: () => <ReorderDemo />,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstItem = canvas.getByRole("button", { name: /item a1/i });
    const handle = firstItem.closest("[data-testid^='media-strip-']")?.querySelector("[data-reorder-handle]") as HTMLElement;

    // Pick up item a1 from Strip A (index 0)
    handle.focus();
    await userEvent.keyboard("{Enter}");

    // Move to Strip B (ArrowDown)
    await userEvent.keyboard("{ArrowDown}");

    // Move within Strip B (ArrowRight)
    await userEvent.keyboard("{ArrowRight}");

    // Cancel (Escape)
    await userEvent.keyboard("{Escape}");

    // Assert it returned to Strip A at index 0
    const stripA = canvasElement.querySelector("[data-strip-id='strip-a']") as HTMLElement;
    await waitFor(() => {
      expect(within(stripA).getByRole("button", { name: /item a1/i })).toBeInTheDocument();
    });
  },
};

export const ReorderWhileScrolled: Story = {
  render: () => {
    const [items, setItems] = useState(() =>
      Array.from({ length: 40 }).map((_, i) =>
        unwrapResult(
          createImageTimelineItem({
            id: `item-${i}`,
            name: `Item ${i}`,
            src: "img.png",
            startTimeSeconds: i * 4,
            durationSeconds: 4,
          })
        )
      )
    );

    const handleMoveItem = useCallback(
      ({ itemId, toIndex }: MediaStripMove) => {
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

    return (
      <MediaStripBoard itemsByStripId={{ "strip-1": items }} onMoveItem={handleMoveItem}>
        <MediaStrip stripId="strip-1" heading="Long Strip for Scrolling" items={items} selectedIds={[]} onSelectionChange={() => {}} />
      </MediaStripBoard>
    );
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background p-8 text-foreground">
        <div className="max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollArea = canvasElement.querySelector("[data-slot='scroll-area-viewport']") as HTMLElement;

    // Scroll deep into the strip (e.g. scrollLeft = 800)
    scrollArea.scrollLeft = 800;
    scrollArea.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(scrollArea.scrollLeft).toBeGreaterThan(500);
    });

    // Find a visible item at this scrolled position (e.g. Item 10)
    await canvas.findByRole("button", { name: /item 10/i });
    const handle = canvasElement.querySelector("[data-reorder-handle='item-10']") as HTMLElement;

    handle.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Enter}");

    // Assert item was moved (Item 10 should be after Item 11)
    // Focus should remain on the handle of Item 10
    await waitFor(() => {
      expect(canvasElement.ownerDocument.activeElement).toBe(handle);
    });

    // Scroll position should not have jumped back to 0
    expect(scrollArea.scrollLeft).toBeGreaterThan(500);
  },
};
