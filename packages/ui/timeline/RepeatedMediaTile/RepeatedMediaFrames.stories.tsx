import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";

import { RepeatedMediaFrames } from "./RepeatedMediaFrames";
import { imageClip, videoClip } from "./story-fixtures";

type RepeatedMediaFramesArgs = {
  displayWidth?: number;
  itemHeight?: number;
};

const withTimelineFrame: Decorator = (Story, context) => {
  const args = context.args as RepeatedMediaFramesArgs;
  const frameWidth = typeof args.displayWidth === "number" ? args.displayWidth : 500;
  const frameHeight = typeof args.itemHeight === "number" ? args.itemHeight : 160;

  return (
    <div
      className="font-sans text-white"
      style={{
        width: frameWidth,
        height: frameHeight,
        background: "#18181b",
        borderRadius: 8,
        overflow: "clip",
      }}
    >
      <Story />
    </div>
  );
};

const meta: Meta<typeof RepeatedMediaFrames> = {
  title: "UI/Timeline/RepeatedMediaTile/RepeatedMediaFrames",
  component: RepeatedMediaFrames,
  decorators: [withTimelineFrame],
  args: {
    clip: imageClip,
    displayWidth: 500,
    itemHeight: 160,
    isXS: false,
  },
};

export default meta;

type Story = StoryObj<typeof RepeatedMediaFrames>;

export const ImageFrames: Story = {};

export const VideoFrames: Story = {
  args: {
    clip: videoClip,
  },
};

export const NarrowImageFrames: Story = {
  args: {
    displayWidth: 220,
  },
};

export const CompactVideoFrame: Story = {
  args: {
    clip: videoClip,
    displayWidth: 220,
    itemHeight: 80,
    isXS: true,
  },
};
