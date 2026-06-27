import type { Meta, StoryObj } from "@storybook/react";

import { TrimHandle } from "./trim-handle";

const meta = {
  title: "GStudio/Timeline/TrimHandle",
  component: TrimHandle,
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: 300,
          height: 200,
          background: "#27272a",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerCancel: () => {},
    onKeyDown: () => {},
  },
} satisfies Meta<typeof TrimHandle>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Left-edge trim handle anchored to the left side of the clip. */
export const LeftEdge: Story = {
  args: {
    edge: "left",
    currentWidth: 300,
  },
};

/** Right-edge trim handle anchored to the right side of the clip. */
export const RightEdge: Story = {
  args: {
    edge: "right",
    currentWidth: 300,
  },
};

/** Left-edge handle with an explicit duration value surfaced via `aria-valuenow`. */
export const WithDuration: Story = {
  args: {
    edge: "left",
    currentWidth: 300,
    currentDuration: 5.5,
  },
};

/** Right-edge handle inside a narrow 60 px clip to verify it still renders correctly. */
export const NarrowContainer: Story = {
  args: {
    edge: "right",
    currentWidth: 60,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: 60,
          height: 200,
          background: "#27272a",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
};
