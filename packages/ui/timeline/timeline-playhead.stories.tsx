import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TimelinePlayhead } from "./timeline-playhead";

const meta = {
  title: "UI/Timeline/TimelinePlayhead",
  component: TimelinePlayhead,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="relative h-24 w-[520px] rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="absolute left-0 top-8 h-10 w-full bg-zinc-900" />
        <Story />
      </div>
    ),
  ],
  args: {
    itemHeight: 40,
    itemTop: 32,
    left: 240,
  },
} satisfies Meta<typeof TimelinePlayhead>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NearStart: Story = {
  args: {
    left: 48,
  },
};
