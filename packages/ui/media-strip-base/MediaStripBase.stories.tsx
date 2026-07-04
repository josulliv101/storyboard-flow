import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import * as MediaStripBase from "./index.parts";

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
    }
);

const storyVideoSrc = "https://res.cloudinary.com/demo/video/upload/dog.mp4";

const createThumbnail = (color: string, label: string) =>
  `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" rx="18" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="white" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;

const createPhotoThumbnail = (seed: string) =>
  `https://picsum.photos/seed/media-strip-${seed}/640/360`;

function durationToSeconds(duration: string) {
  const [minutes = "0", seconds = "0"] = duration.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function getItemWidth(duration: string) {
  const seconds = durationToSeconds(duration);
  return Math.max(96, Math.min(seconds * 32, 320));
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
  },
  {
    id: "cutaway",
    kind: "image",
    title: "Cutaway Texture",
    duration: "00:03",
    thumbnailUrl: createThumbnail("#a16207", "Cut"),
  },
];

function StarterExample() {
  const [selectedId, setSelectedId] = useState("close");

  return (
    <MediaStripBase.Root
      aria-label="Scene media"
      className="w-full max-w-3xl rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-100 shadow-2xl"
    >
      <MediaStripBase.Header className="mb-3 flex items-center justify-between">
        <MediaStripBase.Title className="text-sm font-medium tracking-wide text-zinc-200">
          Scene media
        </MediaStripBase.Title>
        <span className="text-xs text-zinc-500">{items.length} clips</span>
      </MediaStripBase.Header>

      <MediaStripBase.Scroller className="relative">
        <MediaStripBase.Viewport
          inertialDrag
          className="cursor-grab touch-pan-y select-none overflow-x-auto pb-3 data-dragging:cursor-grabbing"
        >
          <MediaStripBase.ViewportContent>
            <MediaStripBase.List
              aria-label="Scene media items"
              className="flex w-max gap-2"
              value={[selectedId]}
              onValueChange={(value) => {
                const [nextSelectedId] = value;
                if (nextSelectedId) {
                  setSelectedId(nextSelectedId);
                }
              }}
            >
              {items.map((item) => {
                const itemWidth = getItemWidth(item.duration);
                const itemDurationSeconds = durationToSeconds(item.duration);

                return (
                  <MediaStripBase.Item
                    key={item.id}
                    className="shrink-0"
                    style={{ width: itemWidth }}
                  >
                    <MediaStripBase.ItemButton
                      value={item.id}
                      aria-label={`Select ${item.title}`}
                      className="group h-full w-full rounded border border-zinc-800 bg-zinc-900 p-1.5 text-left shadow-sm outline-none transition data-pressed:border-sky-400 data-pressed:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-sky-400"
                    >
                      {item.kind === "video" ? (
                        <MediaStripBase.VideoThumbnails
                          src={item.videoSrc}
                          durationSeconds={itemDurationSeconds}
                          frameIntervalSeconds={1.5}
                          maxFrames={8}
                          aria-label={`${item.title} video frames`}
                          className="flex h-24 w-full overflow-hidden rounded-sm bg-zinc-800 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:overflow-hidden [&>span]:border-r [&>span]:border-black/30 [&>span:last-child]:border-r-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover"
                        />
                      ) : (
                        <MediaStripBase.Thumbnail
                          src={item.thumbnailUrl}
                          alt={`${item.title} thumbnail`}
                          draggable={false}
                          className="h-24 w-full rounded-sm object-cover"
                        />
                      )}
                      <MediaStripBase.Content className="mt-2 block min-w-0">
                        <MediaStripBase.ItemTitle className="block truncate text-xs font-medium text-zinc-100">
                          {item.title}
                        </MediaStripBase.ItemTitle>
                        <MediaStripBase.ItemDescription className="mt-0.5 block text-[0.7rem] text-zinc-500">
                          {item.duration}
                        </MediaStripBase.ItemDescription>
                      </MediaStripBase.Content>
                    </MediaStripBase.ItemButton>
                  </MediaStripBase.Item>
                );
              })}
            </MediaStripBase.List>
          </MediaStripBase.ViewportContent>
        </MediaStripBase.Viewport>
        <MediaStripBase.Scrollbar className="mt-1 flex h-1.5 rounded-full bg-zinc-900">
          <MediaStripBase.Thumb className="rounded-full bg-zinc-700" />
        </MediaStripBase.Scrollbar>
      </MediaStripBase.Scroller>
    </MediaStripBase.Root>
  );
}

const meta = {
  title: "UI/MediaStripBase/Primitive",
  component: MediaStripBase.Root,
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-zinc-100 p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MediaStripBase.Root>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Starter: Story = {
  render: () => <StarterExample />,
};

export const Empty: Story = {
  render: () => (
    <MediaStripBase.Root
      aria-label="Scene media"
      className="w-full max-w-3xl rounded-md border border-zinc-800 bg-zinc-950 p-3 text-zinc-100 shadow-2xl"
    >
      <MediaStripBase.Header className="mb-3 flex items-center justify-between">
        <MediaStripBase.Title className="text-sm font-medium tracking-wide text-zinc-200">
          Scene media
        </MediaStripBase.Title>
      </MediaStripBase.Header>
      <MediaStripBase.Empty className="rounded border border-dashed border-zinc-800 bg-zinc-900/70 px-4 py-8 text-center text-sm text-zinc-500">
        No media clips yet.
      </MediaStripBase.Empty>
    </MediaStripBase.Root>
  ),
};
