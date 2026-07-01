import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TimelineClipItemContent } from "./TimelineClipItemContent";
import type { TimelineClip } from "./types";

/* ---------------------------------------------------------------------------
 * Fixtures
 * --------------------------------------------------------------------------- */

// Static placeholder assets — no live network calls
const PLACEHOLDER_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%23334155'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EImage%3C%2Ftext%3E%3C/svg%3E";

const PLACEHOLDER_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EPoster%3C%2Ftext%3E%3C/svg%3E";

const imageClip: TimelineClip = {
  id: "img-content-1",
  index: 0,
  kind: "image",
  src: PLACEHOLDER_IMG,
  alt: "Mountain landscape",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

const videoClip: TimelineClip = {
  id: "vid-content-1",
  index: 1,
  kind: "video",
  src: "",
  poster: PLACEHOLDER_POSTER,
  alt: "Sample video",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 3,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

const sharedArgs = {
  width: 400,
  itemHeight: 160,
  pixelsPerSecond: 100,
  onResizeDown: () => {},
  onResizeMove: () => {},
  onResizeUp: () => {},
  onResizeKeyDown: () => {},
} as const;

/* ---------------------------------------------------------------------------
 * Meta
 * --------------------------------------------------------------------------- */

const meta: Meta<typeof TimelineClipItemContent> = {
  title: "UI/Timeline/TimelineClipItemContent",
  component: TimelineClipItemContent,
  decorators: [
    (Story) => (
      <div
        className="font-sans text-white"
        style={{
          width: 400,
          height: 160,
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
    ...sharedArgs,
    clip: imageClip,
  },
  argTypes: {
    ring: {
      control: { type: "radio" },
      options: ["default", "selected", "lifted", "collectionHovered", "collectionCollapse"],
    },
  },
};

export default meta;

type Story = StoryObj<typeof TimelineClipItemContent>;

/* ---------------------------------------------------------------------------
 * Ring variants
 * --------------------------------------------------------------------------- */

export const Default: Story = {
  args: { ring: "default" },
};

export const Selected: Story = {
  args: {
    ring: "selected",
    isSelected: true,
    clip: videoClip,
  },
};

export const Lifted: Story = {
  args: { ring: "lifted" },
};

export const CollectionHovered: Story = {
  args: {
    ring: "collectionHovered",
    isCollectionHovered: true,
  },
};

export const CollectionCollapse: Story = {
  args: {
    ring: "collectionCollapse",
    isCollectionCollapseCard: true,
  },
};

/* ---------------------------------------------------------------------------
 * State variants
 * --------------------------------------------------------------------------- */

export const GrowingOpposite: Story = {
  args: {
    ring: "selected",
    isSelected: true,
    isGrowingOpposite: true,
  },
};

export const VideoSelected: Story = {
  args: {
    clip: videoClip,
    ring: "selected",
    isSelected: true,
  },
};
