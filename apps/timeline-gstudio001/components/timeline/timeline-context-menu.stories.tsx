import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import { TimelineContextMenu } from "./timeline-context-menu";

const meta = {
  title: "GStudio/Timeline/TimelineContextMenu",
  component: TimelineContextMenu,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="min-h-96 bg-zinc-950 p-8 text-white">
        <div className="h-48 rounded-lg border border-zinc-800 bg-zinc-900" />
        <Story />
      </div>
    ),
  ],
  args: {
    insertIndex: 2,
    onAddClip: fn(),
    onClose: fn(),
    thumbnailMode: false,
    timelineTime: 12.4,
    x: 96,
    y: 88,
  },
} satisfies Meta<typeof TimelineContextMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

export const TimelineMode: Story = {};

export const ThumbnailMode: Story = {
  args: {
    thumbnailMode: true,
  },
};

export const AddVideoAction: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add Video Clip" }));

    await expect(args.onAddClip).toHaveBeenCalledWith(2, "video");
    await expect(args.onClose).toHaveBeenCalled();
  },
};
