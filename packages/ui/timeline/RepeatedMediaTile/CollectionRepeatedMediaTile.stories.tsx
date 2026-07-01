import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent } from "storybook/test";

import { CollectionRepeatedMediaTile } from "./CollectionRepeatedMediaTile";
import { collectionClip, emptyCollectionClip } from "./story-fixtures";

type FrameParameters = {
  width?: number;
  height?: number;
  padding?: number;
};

const withCollectionFrame: Decorator = (Story, context) => {
  const frame = (context.parameters.repeatedMediaFrame ?? {}) as FrameParameters;

  return (
    <div
      className="font-sans text-white"
      style={{
        width: frame.width ?? 360,
        height: frame.height ?? 180,
        background: "#18181b",
        borderRadius: 8,
        overflow: "clip",
        padding: frame.padding ?? 12,
      }}
    >
      <Story />
    </div>
  );
};

const meta: Meta<typeof CollectionRepeatedMediaTile> = {
  title: "UI/Timeline/RepeatedMediaTile/CollectionRepeatedMediaTile",
  component: CollectionRepeatedMediaTile,
  decorators: [withCollectionFrame],
  args: {
    clip: collectionClip,
    isXS: false,
  },
};

export default meta;

type Story = StoryObj<typeof CollectionRepeatedMediaTile>;

export const Default: Story = {};

export const EndpointSelection: Story = {
  args: {
    collectionEndpointSelection: {
      first: true,
      last: true,
    },
    onCollectionEndpointClick: fn(),
  },
  play: async ({ args, canvas }) => {
    const firstEndpoint = canvas.getByRole("button", {
      name: "Scene Selects first item",
    });
    const lastEndpoint = canvas.getByRole("button", {
      name: "Scene Selects last item",
    });

    await expect(firstEndpoint).toHaveAttribute("aria-pressed", "true");
    await expect(lastEndpoint).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(firstEndpoint);
    await userEvent.click(lastEndpoint);
    await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("first");
    await expect(args.onCollectionEndpointClick).toHaveBeenCalledWith("last");
  },
};

export const EmptyCollection: Story = {
  args: {
    clip: emptyCollectionClip,
  },
};

export const CompactHeight: Story = {
  args: {
    isXS: true,
  },
  parameters: {
    repeatedMediaFrame: {
      width: 240,
      height: 80,
      padding: 8,
    },
  },
};
