import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import {
  RepeatedMediaTile,
  type RepeatedMediaTileProps,
} from "./RepeatedMediaTile";
import { collectionClip, imageClip, videoClip } from "./story-fixtures";

const withTimelineFrame: Decorator = (Story, context) => {
  const args = context.args as Partial<RepeatedMediaTileProps>;
  const frameWidth = typeof args.displayWidth === "number" ? args.displayWidth : 500;
  const frameHeight = typeof args.itemHeight === "number" ? args.itemHeight : 200;

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

const meta: Meta<typeof RepeatedMediaTile> = {
  title: "UI/Timeline/RepeatedMediaTile",
  component: RepeatedMediaTile,
  decorators: [withTimelineFrame],
  args: {
    onDurationLoaded: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof RepeatedMediaTile>;

/** Default image clip rendered at full container width. */
export const ImageClip: Story = {
  args: {
    clip: imageClip,
    displayWidth: 300,
    previewTime: 0,
    itemHeight: 100,
  },
};

/** Video clip with a trimmed source, previewed at 2 s. */
export const VideoClip: Story = {
  args: {
    clip: videoClip,
    displayWidth: 500,
    previewTime: 2,
    itemHeight: 200,
  },
};

/** Collection clip rendered through the wrapper branch. */
export const CollectionClip: Story = {
  args: {
    clip: collectionClip,
    displayWidth: 500,
    previewTime: 0,
    itemHeight: 200,
    collectionEndpointSelection: {
      first: true,
    },
    onCollectionEndpointClick: fn(),
  },
  play: async ({ args, canvas }) => {
    const firstEndpoint = canvas.getByRole("button", {
      name: "Scene Selects first item",
    });

    await expect(firstEndpoint).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(firstEndpoint);
    await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("first");
  },
};

/** Narrow container: fewer repeated tiles visible. */
export const NarrowWidth: Story = {
  args: {
    clip: imageClip,
    displayWidth: 200,
    previewTime: 0,
    itemHeight: 200,
  },
};

/** Wide container: more repeated tiles visible. */
export const WideWidth: Story = {
  args: {
    clip: imageClip,
    displayWidth: 800,
    previewTime: 0,
    itemHeight: 200,
  },
};

/** Shorter item height: tiles scale down vertically. */
export const SmallHeight: Story = {
  args: {
    clip: imageClip,
    displayWidth: 500,
    previewTime: 0,
    itemHeight: 120,
  },
};
