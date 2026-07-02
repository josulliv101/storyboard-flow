import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";

import { getTimelineDocument } from "./timeline-documents";
import { createInitialClips } from "./hooks/use-timeline-clips";
import { SmoothScrollList } from "./smooth-scroll-list";
import type { TimelineClip } from "./types";

function createStoryMediaDataUri(label: string, hue: number) {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},70%,38%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 52) % 360},75%,18%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="480" height="270" fill="url(#g)"/>`,
    `<circle cx="394" cy="58" r="42" fill="rgba(255,255,255,0.18)"/>`,
    `<rect x="28" y="176" width="320" height="22" rx="11" fill="rgba(255,255,255,0.18)"/>`,
    `<rect x="28" y="210" width="210" height="16" rx="8" fill="rgba(255,255,255,0.12)"/>`,
    `<text x="28" y="74" fill="white" font-family="Arial, sans-serif" font-size="34" font-weight="700">${label}</text>`,
    `</svg>`,
  ].join("");

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function withDeterministicStoryMedia(clips: TimelineClip[]): TimelineClip[] {
  return clips.map((clip) => {
    const mediaSrc = createStoryMediaDataUri(
      `${clip.kind === "video" ? "Video" : "Image"} ${clip.index}`,
      (clip.index * 37 + (clip.kind === "video" ? 210 : 135)) % 360,
    );

    if (clip.kind === "video") {
      return {
        ...clip,
        poster: mediaSrc,
      };
    }

    if (clip.kind === "image") {
      return {
        ...clip,
        src: mediaSrc,
      };
    }

    return {
      ...clip,
      previewItems: clip.previewItems?.map((item, itemIndex) => ({
        ...item,
        poster:
          item.kind === "video"
            ? createStoryMediaDataUri(
                `Preview ${clip.index}.${itemIndex}`,
                (clip.index * 37 + itemIndex * 29 + 210) % 360,
              )
            : item.poster,
        src:
          item.kind === "image"
            ? createStoryMediaDataUri(
                `Preview ${clip.index}.${itemIndex}`,
                (clip.index * 37 + itemIndex * 29 + 135) % 360,
              )
            : item.src,
      })),
    };
  });
}

function createSmoothScrollStoryClips(itemCount: number): TimelineClip[] {
  return withDeterministicStoryMedia(createInitialClips(itemCount, 100));
}

const meta = {
  title: "UI/Timeline/SmoothScrollList",
  component: SmoothScrollList,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        <Story />
      </main>
    ),
  ],
  args: {
    initialClips: createSmoothScrollStoryClips(12),
    itemCount: 12,
    onPlayheadTimeChange: fn(),
    pixelsPerSecond: 100,
    viewportWidth: "100%",
    syncMediaDuration: false,
    disablePersistence: true,
    navigate: fn(),
  },
} satisfies Meta<typeof SmoothScrollList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CollectionTimeline: Story = {
  args: {
    initialClips: withDeterministicStoryMedia(getTimelineDocument("root")?.clips ?? []),
    itemCount: getTimelineDocument("root")?.clips.length ?? 0,
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
    syncMediaDuration: false,
    timelineId: "root",
  },
};

export const ThumbnailMode: Story = {
  args: {
    initialViewState: {
      thumbnailMode: true,
    },
  },
};

export const FirstClipSelectedAtTimelineStart: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clip = await canvas.findByTestId("timeline-clip-0");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(clip).toHaveAttribute("data-start-time", "0");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
  },
};

export const FirstClipSelectedWithThumbnailOverhang: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const clip = await canvas.findByTestId("timeline-clip-0");
    await userEvent.click(clip);

    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toBeVisible();
  },
};

export const LastClipSelectedAtTimelineEnd: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId("timeline-scroll-viewport");
    fireEvent.scroll(viewport, { target: { scrollLeft: 2400 } });

    await waitFor(async () => {
      await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
    });

    const clip = canvas.getByTestId("timeline-clip-11");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
  },
};

export const LastClipSelectedWithThumbnailOverhang: Story = {
  args: {
    initialViewState: {
      showPlayBarArea: true,
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const viewport = canvas.getByTestId("timeline-scroll-viewport");
    fireEvent.scroll(viewport, { target: { scrollLeft: 3200 } });

    await waitFor(async () => {
      await expect(canvas.getByTestId("timeline-clip-11")).toBeVisible();
    });

    const clip = canvas.getByTestId("timeline-clip-11");
    await userEvent.click(clip);
    await expect(clip).toHaveAttribute("data-selected", "true");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
    await expect(canvas.getByTestId("timeline-source-filmstrip")).toHaveAttribute("data-clip-index", "11");
  },
};

export const ZoomedOut: Story = {
  args: {
    pixelsPerSecond: 20,
  },
};

export const ZoomedIn: Story = {
  args: {
    pixelsPerSecond: 250,
  },
};

export const Empty: Story = {
  args: {
    initialClips: [],
    itemCount: 0,
  },
};

export const HundredClips: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(100),
    itemCount: 100,
  },
};

export const VirtualizedThousandClips: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(1000),
    itemCount: 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
  },
};

export const VirtualizedThousandClipsThumbnail: Story = {
  args: {
    initialClips: createSmoothScrollStoryClips(1000),
    itemCount: 1000,
    initialViewState: {
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-thumbnail-mode", "true");
  },
};

export const MultipleTimelines: Story = {
  render: (args) => (
    <div className="grid gap-16">
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
      />
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
      />
    </div>
  ),
};

export const MultipleTimelinesThumbnail: Story = {
  render: (args) => (
    <div className="grid gap-16">
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
        initialViewState={{ thumbnailMode: true }}
      />
      <SmoothScrollList
        {...args}
        initialClips={createSmoothScrollStoryClips(1000)}
        itemCount={1000}
        initialViewState={{ thumbnailMode: true }}
      />
    </div>
  ),
};
