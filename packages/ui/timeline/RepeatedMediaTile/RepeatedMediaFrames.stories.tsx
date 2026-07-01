import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import { RepeatedMediaFrames } from "./RepeatedMediaFrames";
import { RepeatedMediaFrame } from "./RepeatedMediaFrame";
import { getVideoThumbnailUrl } from "../media-thumbnails";
import { storyVideoSrc, storyVideoPoster } from "./story-fixtures";

const FRAME_W = 96;
const FRAME_H = 96;

const withTimelineFrame: Decorator = (_Story, context) => {
  const width = (context.args as { storyWidth?: number }).storyWidth ?? 500;
  const height = (context.args as { storyHeight?: number }).storyHeight ?? 160;

  return (
    <div
      className="font-sans text-white"
      style={{
        width,
        height,
        background: "#18181b",
        borderRadius: 8,
        overflow: "clip",
      }}
    >
      <_Story />
    </div>
  );
};

const meta: Meta<typeof RepeatedMediaFrames> = {
  title: "UI/Timeline/RepeatedMediaTile/RepeatedMediaFrames",
  component: RepeatedMediaFrames,
  decorators: [withTimelineFrame],
};

export default meta;

type Story = StoryObj<typeof RepeatedMediaFrames>;

export const ImageFrames: Story = {
  render: () => (
    <RepeatedMediaFrames>
      {[0, 1, 2, 3, 4].map((i) => (
        <RepeatedMediaFrame
          key={i}
          src={`https://picsum.photos/seed/frame-${i}/400/200`}
          alt={`Image frame ${i + 1}`}
          frameWidth={FRAME_W}
          frameHeight={FRAME_H}
        />
      ))}
    </RepeatedMediaFrames>
  ),
};

export const VideoFrames: Story = {
  render: () => (
    <RepeatedMediaFrames>
      {[0, 2, 4, 6, 8].map((second, i) => (
        <RepeatedMediaFrame
          key={i}
          src={getVideoThumbnailUrl(storyVideoSrc, second)}
          alt={`Video frame ${i + 1}`}
          fallbackSrc={storyVideoPoster}
          frameWidth={FRAME_W}
          frameHeight={FRAME_H}
        />
      ))}
    </RepeatedMediaFrames>
  ),
};

export const NarrowImageFrames: Story = {
  render: () => (
    <RepeatedMediaFrames>
      {[0, 1].map((i) => (
        <RepeatedMediaFrame
          key={i}
          src={`https://picsum.photos/seed/narrow-${i}/400/200`}
          alt={`Narrow frame ${i + 1}`}
          frameWidth={FRAME_W}
          frameHeight={FRAME_H}
        />
      ))}
    </RepeatedMediaFrames>
  ),
};

export const SingleXSFrame: Story = {
  render: () => (
    <RepeatedMediaFrames>
      <RepeatedMediaFrame
        src="https://picsum.photos/seed/xs-frame/400/200"
        alt="XS single frame"
        frameWidth={220}
        frameHeight={40}
      />
    </RepeatedMediaFrames>
  ),
};
