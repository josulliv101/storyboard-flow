import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import { MediaStrip, type MediaStripItem } from "./MediaStrip";

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

function getItemWidth(duration: string) {
  const seconds = durationToSeconds(duration);
  return Math.max(96, Math.min(seconds * 32, 320));
}

function toMediaStripItem(item: StoryMediaItem): MediaStripItem {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.duration,
    thumbnailUrl: item.thumbnailUrl,
    videoSrc: item.kind === "video" ? item.videoSrc : undefined,
    width: getItemWidth(item.duration),
    alt:
      item.kind === "video"
        ? `${item.title} video thumbnail at ${item.thumbnailTime}`
        : `${item.title} ${item.kind}`,
  };
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
    duration: "00:06",
    thumbnailUrl: createPhotoThumbnail("character-closeup"),
  },
  {
    id: "insert",
    kind: "image",
    title: "Insert Detail",
    duration: "00:03",
    thumbnailUrl: createThumbnail("#059669", "Insert"),
  },
  {
    id: "reverse",
    kind: "image",
    title: "Reverse Angle",
    duration: "00:05",
    thumbnailUrl: createPhotoThumbnail("reverse-angle"),
  },
  {
    id: "tracking",
    kind: "video",
    title: "Tracking Shot",
    duration: "00:09",
    videoSrc: storyVideoSrc,
    thumbnailTime: "00:02",
    thumbnailUrl: dogVideoThumbnails["00:02"],
  },
  {
    id: "overhead",
    kind: "image",
    title: "Overhead Layout",
    duration: "00:04",
    thumbnailUrl: createThumbnail("#0891b2", "Top"),
  },
  {
    id: "reaction",
    kind: "image",
    title: "Reaction Beat",
    duration: "00:02",
    thumbnailUrl: createPhotoThumbnail("reaction-beat"),
  },
  {
    id: "handoff",
    kind: "image",
    title: "Prop Handoff",
    duration: "00:07",
    thumbnailUrl: createThumbnail("#4f46e5", "Prop"),
  },
  {
    id: "exit",
    kind: "video",
    title: "Exit Frame",
    duration: "00:05",
    videoSrc: storyVideoSrc,
    thumbnailTime: "00:04",
    thumbnailUrl: dogVideoThumbnails["00:04"],
  },
  {
    id: "cutaway",
    kind: "image",
    title: "Cutaway Texture",
    duration: "00:03",
    thumbnailUrl: createThumbnail("#a16207", "Cut"),
  },
];

const mediaItems = items.map(toMediaStripItem);
const repeatedThumbnail = createThumbnail("#475569", "Repeat");

const shortAndLongItems: MediaStripItem[] = [
  {
    id: "clip-short",
    title: "Flash Insert",
    subtitle: "00:01",
    thumbnailUrl: createThumbnail("#0891b2", "Short"),
    width: getItemWidth("00:01"),
  },
  {
    id: "clip-long",
    title: "Extended Walkthrough",
    subtitle: "02:15",
    thumbnailUrl: createThumbnail("#9333ea", "Long"),
    width: getItemWidth("02:15"),
  },
  {
    id: "clip-trimmed",
    title: "Trimmed Dialogue",
    subtitle: "Trim 00:03-00:12",
    thumbnailUrl: createThumbnail("#ea580c", "Trim"),
    width: getItemWidth("00:09"),
  },
];

const manyItems = Array.from({ length: 3 }, () => items)
  .flat()
  .map((item, index) =>
    toMediaStripItem({
      ...item,
      id: `${item.id}-${index + 1}`,
      title: `${item.title} ${index + 1}`,
    }),
  );

const meta = {
  title: "UI/MediaStrip/MediaStrip",
  component: MediaStrip,
  args: {
    onAction: fn(),
    onSelectItem: fn(),
    items: mediaItems,
    selectedId: "close",
    title: "Scene media",
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

    await expect(args.onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "insert" }),
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
    selectedId: "wide",
  },
  play: async ({ args, canvas, canvasElement }) => {
    const firstClip = canvas.getByRole("button", { name: /opening wide/i });

    firstClip.focus();
    await userEvent.keyboard("{ArrowRight}{Enter}");

    await expect(canvasElement.ownerDocument.activeElement).toBe(
      canvas.getByRole("button", { name: /character closeup/i }),
    );
    await expect(args.onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: "close" }),
    );
  },
};

export const Empty: Story = {
  args: {
    items: [],
    selectedId: undefined,
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: /add media/i }));

    await expect(args.onAction).toHaveBeenCalled();
  },
};

export const MissingPosterFallback: Story = {
  args: {
    items: [
      {
        id: "clip-missing",
        title: "Offline Poster",
        subtitle: "00:08",
        width: getItemWidth("00:08"),
      },
      mediaItems[0],
      mediaItems[1],
    ],
    selectedId: "clip-missing",
  },
};

export const RepeatedThumbnails: Story = {
  args: {
    items: [
      {
        id: "repeat-1",
        title: "Take One",
        subtitle: "00:05",
        thumbnailUrl: repeatedThumbnail,
        width: getItemWidth("00:05"),
      },
      {
        id: "repeat-2",
        title: "Take Two",
        subtitle: "00:05",
        thumbnailUrl: repeatedThumbnail,
        width: getItemWidth("00:05"),
      },
      {
        id: "repeat-3",
        title: "Take Three",
        subtitle: "00:05",
        thumbnailUrl: repeatedThumbnail,
        width: getItemWidth("00:05"),
      },
    ],
    selectedId: "repeat-2",
  },
};

export const ShortLongAndTrimmedClips: Story = {
  args: {
    items: shortAndLongItems,
    selectedId: "clip-trimmed",
  },
};

export const ManyItemTimeline: Story = {
  args: {
    items: manyItems,
    selectedId: "cutaway-10",
    title: "Timeline media",
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
