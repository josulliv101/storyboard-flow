import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  TimelineDropIndicator,
  TimelineDropOverlay,
} from "./timeline-drop-overlays";

const overlayMeta = {
  title: "UI/Timeline/overlays/TimelineDropOverlay",
  component: TimelineDropOverlay,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="relative h-56 w-[640px] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="grid h-full grid-cols-4 gap-3 p-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="rounded-md border border-zinc-800 bg-zinc-900/80"
            />
          ))}
        </div>
        <Story />
      </div>
    ),
  ],
  args: {
    isVisible: true,
  },
} satisfies Meta<typeof TimelineDropOverlay>;

export default overlayMeta;

type OverlayStory = StoryObj<typeof overlayMeta>;

export const ActiveDrop: OverlayStory = {};

export const Hidden: OverlayStory = {
  args: {
    isVisible: false,
  },
};

type IndicatorStory = StoryObj<typeof TimelineDropIndicator>;

export const InsertIndicator: IndicatorStory = {
  render: () => (
    <div className="relative h-28 w-[640px] rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="absolute left-8 top-8 h-12 w-28 rounded-md bg-zinc-800" />
      <div className="absolute left-48 top-8 h-12 w-28 rounded-md bg-zinc-800" />
      <TimelineDropIndicator itemHeight={48} itemTop={32} left={176} />
    </div>
  ),
};
