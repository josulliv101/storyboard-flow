import type { Meta, StoryObj } from "@storybook/react";
import { VideoTile } from "./video-tile";

const STORY_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 270'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%231e3a8a'/%3E%3Cstop offset='1' stop-color='%230f172a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='480' height='270' fill='url(%23g)'/%3E%3Ccircle cx='390' cy='70' r='44' fill='rgba(255,255,255,0.16)'/%3E%3Crect x='28' y='170' width='304' height='22' rx='11' fill='rgba(255,255,255,0.18)'/%3E%3Crect x='28' y='206' width='196' height='16' rx='8' fill='rgba(255,255,255,0.12)'/%3E%3Ctext x='28' y='78' fill='white' font-family='Arial,sans-serif' font-size='34' font-weight='700'%3EPoster%3C/text%3E%3C/svg%3E";

const meta = {
  title: "UI/Timeline/media/VideoTile",
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
    poster: STORY_POSTER,
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
    poster: STORY_POSTER,
  },
};
