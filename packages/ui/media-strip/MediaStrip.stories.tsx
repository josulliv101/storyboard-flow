import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import { MediaStrip } from "./media-strip";
import {
  asTimelineItemId,
  type TimelineItem,
  type TimelineItemId,
  type TimelineItemResult,
} from "./media-strip.types";
import {
  createImageTimelineItem,
  createVideoTimelineItem,
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
      posterSrc: item.thumbnailUrl,
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
      posterSrc: item.thumbnailUrl,
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
    posterSrc: thumb,
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

const meta = {
  title: "UI/MediaStrip/MediaStrip",
  component: MediaStrip,
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
} satisfies Meta<typeof MediaStrip>;

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
          src: "",
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
          posterSrc: repeatedThumbnail,
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "repeat-2" as TimelineItemId,
          name: "Take Two",
          src: repeatedThumbnail,
          posterSrc: repeatedThumbnail,
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "repeat-3" as TimelineItemId,
          name: "Take Three",
          src: repeatedThumbnail,
          posterSrc: repeatedThumbnail,
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
          posterSrc: repeatedThumbnail,
          startTimeSeconds: 0,
          durationSeconds: 5,
        })
      ),
      unwrapResult(
        createImageTimelineItem({
          id: "single-2" as TimelineItemId,
          name: "Take Two (Single Image)",
          src: repeatedThumbnail,
          posterSrc: repeatedThumbnail,
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
          posterSrc: createThumbnail("#b91c1c", "Frame 1"),
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
          posterSrc: createThumbnail("#b91c1c", "Frame 1"),
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
          posterSrc: createThumbnail("#b91c1c", "Frame 1"),
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
          posterSrc: createThumbnail("#b91c1c", "Frame 1"),
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
      '[data-testid="media-strip-drag-scroll"]',
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
          posterSrc: "https://example.com/broken-image.jpg",
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
