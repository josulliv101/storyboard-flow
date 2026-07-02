import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import {
  createStoryMediaDataUri,
  storyImageSrc,
  storyVideoPoster,
  storyVideoSrc,
} from "./story-fixtures";
import { getVideoThumbnailUrl } from "../media-thumbnails";

const withFrameWrapper: Decorator = (Story) => (
  <div
    className="font-sans"
    style={{
      display: "inline-flex",
      background: "#18181b",
      borderRadius: 8,
      overflow: "clip",
    }}
  >
    <Story />
  </div>
);

const meta: Meta<typeof RepeatedMediaFrame> = {
  title: "UI/Timeline/media/RepeatedMediaTile/RepeatedMediaFrame",
  component: RepeatedMediaFrame,
  decorators: [withFrameWrapper],
  argTypes: {
    variant: {
      control: { type: "radio" },
      options: ["default", "unstyled"],
    },
  },
  args: {
    variant: "default",
    frameWidth: 96,
    frameHeight: 96,
  },
};

export default meta;

type Story = StoryObj<typeof RepeatedMediaFrame>;

export const ImageFrame: Story = {
  args: {
    src: storyImageSrc,
    alt: "Sample image frame",
  },
};

export const VideoFrame: Story = {
  args: {
    src: getVideoThumbnailUrl(storyVideoSrc, 2),
    alt: "Sample video frame 1",
    fallbackSrc: storyVideoPoster,
  },
};

export const NarrowFrame: Story = {
  args: {
    src: createStoryMediaDataUri("Narrow", 155),
    alt: "Narrow image frame",
    frameWidth: 56,
    frameHeight: 56,
  },
};

export const WithFallback: Story = {
  name: "Broken src with fallback poster",
  args: {
    src: "https://example.invalid/broken.mp4?so=2.00&w=480&h=270",
    alt: "Broken video frame",
    fallbackSrc: storyVideoPoster,
    frameWidth: 96,
    frameHeight: 96,
  },
};

// ─── Unstyled variant ───────────────────────────────────────────────────────

export const UnstyledImage: Story = {
  name: "Unstyled / Image",
  args: {
    variant: "unstyled",
    src: storyImageSrc,
    alt: "Unstyled image frame",
  },
};

export const UnstyledVideo: Story = {
  name: "Unstyled / Video",
  args: {
    variant: "unstyled",
    src: getVideoThumbnailUrl(storyVideoSrc, 2),
    alt: "Unstyled video frame 1",
    fallbackSrc: storyVideoPoster,
  },
};
