import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { getTimelineDocument } from "@/lib/timeline-documents";
import { SmoothScrollList } from "./smooth-scroll-list";

const meta = {
  title: "GStudio/Timeline/SmoothScrollList",
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
    itemCount: 12,
    pixelsPerSecond: 100,
    viewportWidth: "100%",
    syncMediaDuration: false,
  },
} satisfies Meta<typeof SmoothScrollList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CollectionTimeline: Story = {
  args: {
    initialClips: getTimelineDocument("root")?.clips,
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "To 800" }));

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
      thumbnailMode: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "To 800" }));

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
    itemCount: 0,
  },
};

export const HundredClips: Story = {
  args: {
    itemCount: 100,
  },
};

export const VirtualizedThousandClips: Story = {
  args: {
    itemCount: 1000,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("timeline-editor")).toHaveAttribute("data-item-count", "1000");
  },
};

export const VirtualizedThousandClipsThumbnail: Story = {
  args: {
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
      <SmoothScrollList {...args} itemCount={1000} />
      <SmoothScrollList {...args} itemCount={1000} />
    </div>
  ),
};

export const MultipleTimelinesThumbnail: Story = {
  render: (args) => (
    <div className="grid gap-16">
      <SmoothScrollList {...args} itemCount={1000} initialViewState={{ thumbnailMode: true }} />
      <SmoothScrollList {...args} itemCount={1000} initialViewState={{ thumbnailMode: true }} />
    </div>
  ),
};
