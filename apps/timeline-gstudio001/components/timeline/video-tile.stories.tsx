import type { Meta, StoryObj } from "@storybook/react";
import { VideoTile } from "./video-tile";

const meta = {
  title: "GStudio/Timeline/VideoTile",
  component: VideoTile,
  decorators: [
    (Story) => (
      <div
        style={{
          width: 320,
          height: 200,
          background: "#09090b",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onDurationLoaded: () => {},
  },
} satisfies Meta<typeof VideoTile>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Basic video with just `src` and `alt` — no seeking, no poster. */
export const Default: Story = {
  args: {
    src: "https://www.w3schools.com/html/mov_bbb.mp4",
    alt: "Big Buck Bunny clip",
  },
};

/** Seeks to 3 s within a 10 s source-duration timeline. */
export const WithPreviewTime: Story = {
  args: {
    src: "https://www.w3schools.com/html/movie.mp4",
    alt: "Movie clip with preview time",
    previewTime: 3,
    sourceDuration: 10,
  },
};

/** Shows a poster image before any metadata has loaded. */
export const WithPoster: Story = {
  args: {
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    alt: "Flower video with poster",
    poster: "https://picsum.photos/seed/video-poster/320/200",
  },
};

/** Seeks near the very end of the video (9.5 s out of 10 s). */
export const SeekToEnd: Story = {
  args: {
    src: "https://www.w3schools.com/html/mov_bbb.mp4",
    alt: "Big Buck Bunny — near end",
    previewTime: 9.5,
    sourceDuration: 10,
  },
};

/** `previewTime` explicitly set to `null` — should show poster or frame 0. */
export const NullPreviewTime: Story = {
  args: {
    src: "https://www.w3schools.com/html/movie.mp4",
    alt: "Movie clip — no preview",
    previewTime: null,
    poster: "https://picsum.photos/seed/video-poster/320/200",
  },
};
