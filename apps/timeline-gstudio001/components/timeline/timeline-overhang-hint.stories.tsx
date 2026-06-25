import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { TimelineOverhangHint } from "./timeline-overhang-hint";

const meta = {
  title: "GStudio/Timeline/TimelineOverhangHint",
  component: TimelineOverhangHint,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="relative h-48 w-[640px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
        <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-amber-400/10 to-transparent" />
        <Story />
      </div>
    ),
  ],
  args: {
    onClick: fn(),
  },
} satisfies Meta<typeof TimelineOverhangHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RevealsSourceOnClick: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const hint = canvas.getByRole("button", { name: "Source" });

    await expect(hint).toHaveAttribute(
      "title",
      "Filmstrip extends beyond the visible area. Click to scroll and reveal the full source filmstrip.",
    );
    await userEvent.click(hint);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
