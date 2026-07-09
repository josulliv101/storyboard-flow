import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useCallback, useEffect, useMemo } from "react";
import { expect, fn, userEvent } from "storybook/test";

import { MediaStrip, type MediaStripProps, type MediaStripSelection } from "./media-strip";
import { MediaStripBoard } from "./media-strip-board";
import { dndKitMediaStripDndAdapter } from "./adapters/dnd-kit-adapter";
import {
  trustedTimelineItemId,
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
} from "./core/media-strip.validation";
import {
  unwrapResult,
  createThumbnail,
  createPhotoThumbnail,
  createImg,
} from "./media-strip.stories-helpers";

// This file covers the "basic" single-strip stories driven by
// `StatefulMediaStrip`'s args (selection, empty state, thumbnail rendering,
// scaling). See the sibling `MediaStrip.*.stories.tsx` files for
// cross-strip drag/reorder, nested collections, scale, and layout edge cases —
// each is nested under "MediaStrip" as its own named sub-group in
// Storybook's sidebar (title = "UI/MediaStrip/MediaStrip/<Group>").

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

// No local fixture video ships with this package (only the poster PNGs
// do) — this is a small public demo clip, not project media.
const storyVideoSrc = "https://res.cloudinary.com/demo/video/upload//dog.mp4";
const dogVideoThumbnails = {
  "00:02": new URL("./fixtures/dog-tracking-2s.png", import.meta.url).href,
  "00:04": new URL("./fixtures/dog-exit-4s.png", import.meta.url).href,
} satisfies Record<string, string>;

function durationToSeconds(duration: string) {
  const [minutes = "0", seconds = "0"] = duration.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function toTimelineItem(item: StoryMediaItem): TimelineItem {
  // The factories accept unbranded string ids and validate them internally.
  const seconds = durationToSeconds(item.duration);

  if (item.kind === "video") {
    const result = createVideoTimelineItem({
      id: item.id,
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
      id: item.id,
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

function StatefulMediaStrip(props: MediaStripProps & { items?: readonly TimelineItem[] }) {
  const [items, setItems] = useState<readonly TimelineItem[]>(() => props.items || []);
  const [selectedIds, setSelectedIds] = useState<readonly TimelineItemId[]>(() => props.selectedIds || []);

  useEffect(() => {
    setItems(props.items || []);
  }, [props.items]);

  useEffect(() => {
    setSelectedIds(props.selectedIds || []);
  }, [props.selectedIds]);

  const handleMoveItem = useCallback(
    (command: TimelineItemCommand) => {
      if (command.type !== "move") return;
      const { itemId, toIndex } = command;
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

  const collectionId = props.collectionId || (trustedCollectionId("default-strip"));
  const collectionsById = useMemo(() => new Map<CollectionId, TimelineCollection>([
    [collectionId, {
      id: collectionId,
      name: collectionId,
      items,
    }]
  ]), [collectionId, items]);
  const visibleCollectionIds = useMemo(() => [collectionId], [collectionId]);

  return (
    <MediaStripBoard
      collectionsById={collectionsById}
      dndAdapter={dndKitMediaStripDndAdapter}
      visibleCollectionIds={visibleCollectionIds}
      onMoveItem={handleMoveItem}
    >
      <MediaStrip
        {...props}
        collectionId={collectionId}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
      />
    </MediaStripBoard>
  );
}

const meta = {
  title: "UI/MediaStrip/MediaStrip/Basics",
  component: StatefulMediaStrip,
  args: {
    onAction: fn(),
    onSelectionChange: fn(),
    items: mediaItems,
    selectedIds: [trustedTimelineItemId("close")],
    heading: "Scene media",
  },
  // Single shared decorator — story-level decorators STACK with this one, so
  // per-story copies double-wrap the canvas. Only add a story-level decorator
  // when the story genuinely needs a different frame (see VeryNarrowContainer
  // in MediaStrip.edge-cases.stories.tsx).
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
        selectedIds: expect.arrayContaining([trustedTimelineItemId("insert")]),
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
    selectedIds: [trustedTimelineItemId("wide")],
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
        selectedIds: expect.arrayContaining([trustedTimelineItemId("close")]),
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
          id: trustedTimelineItemId("clip-missing"),
          name: "Offline Poster",
          src: "https://example.com/offline-media.jpg",
          startTimeSeconds: 0,
          durationSeconds: 8,
        })
      ),
      mediaItems[0],
      mediaItems[1],
    ],
    selectedIds: [trustedTimelineItemId("clip-missing")],
  },
};

export const RepeatedThumbnails: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("repeat-1"),
          name: "Take One",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("repeat-2"),
          name: "Take Two",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("repeat-3"),
          name: "Take Three",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
    ],
    selectedIds: [trustedTimelineItemId("repeat-2")],
    pxPerSecond: 80,
  },
};

export const SingleImageThumbnails: Story = {
  args: {
    thumbnailVariant: "single",
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("single-1"),
          name: "Take One (Single Image)",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("single-2"),
          name: "Take Two (Single Image)",
          src: repeatedThumbnail,
          posterSrcs: [repeatedThumbnail],
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
    ],
    selectedIds: [trustedTimelineItemId("single-1")],
  },
};

export const SequenceOfDifferentImages: Story = {
  args: {
    items: [
      unwrapResult(
        createImageTimelineItem({
          id: trustedTimelineItemId("seq-diff-1"),
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
          id: trustedTimelineItemId("seq-diff-2"),
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
          id: trustedTimelineItemId("seq-diff-3"),
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
          id: trustedTimelineItemId("seq-diff-4"),
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
    selectedIds: [trustedTimelineItemId("seq-diff-2")],
  },
};

export const ShortLongAndTrimmedClips: Story = {
  args: {
    items: shortAndLongItems,
    selectedIds: [trustedTimelineItemId("clip-trimmed")],
  },
};

export const ManyItemTimeline: Story = {
  args: {
    items: manyItems,
    selectedIds: [trustedTimelineItemId("cutaway-10")],
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
    selectedIds: [trustedTimelineItemId("wide"), trustedTimelineItemId("close")],
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
    selectedIds: [trustedTimelineItemId("wide")],
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /character closeup/i }),
    );

    await expect(args.onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIds: expect.arrayContaining([
          trustedTimelineItemId("wide"),
          trustedTimelineItemId("close"),
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
          id: trustedTimelineItemId("clip-broken"),
          name: "Broken Link Poster",
          src: "https://example.com/broken-image.jpg",
          posterSrcs: ["https://example.com/broken-image.jpg"],
          startTimeSeconds: 0,
          durationSeconds: 6,
        })
      ),
      mediaItems[0],
    ],
    selectedIds: [trustedTimelineItemId("clip-broken")],
  },
};

export const KeyboardVirtualNavigation: Story = {
  args: {
    selectedIds: [trustedTimelineItemId("wide")],
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
        selectedIds: expect.arrayContaining([trustedTimelineItemId("cutaway-10")]),
      }),
    );
  },
};
