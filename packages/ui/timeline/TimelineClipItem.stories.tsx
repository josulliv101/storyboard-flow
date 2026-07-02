import React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import {
  TimelineClipItem,
  type TimelineClipItemState,
} from "./TimelineClipItem";
import {
  TimelineClipItemProvider,
  type TimelineClipCollectionActions,
  type TimelineClipItemContextValue,
  type TimelineClipItemMetrics,
  type TimelineClipMediaActions,
  type TimelineClipResizeHandlers,
} from "./TimelineClipItemContext";
import type { CollectionTimelineClip, ImageTimelineClip, TimelineClip } from "./types";

const PLACEHOLDER_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%23334155'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EImage%3C%2Ftext%3E%3C/svg%3E";

const PLACEHOLDER_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EPoster%3C%2Ftext%3E%3C/svg%3E";

const THUMB_W = 160;
const THUMB_GAP = 12;

function makeImageClip(index: number, overrides?: Partial<ImageTimelineClip>): ImageTimelineClip {
  return {
    id: `img-story-${index}`,
    index,
    kind: "image",
    src: PLACEHOLDER_IMG,
    alt: `Image clip ${index}`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: index * 3,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  };
}

const imageClip = makeImageClip(0);

const videoClip: TimelineClip = {
  id: "vid-story-1",
  index: 0,
  kind: "video",
  src: "",
  poster: PLACEHOLDER_POSTER,
  alt: "Sample video",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

const collectionClip: CollectionTimelineClip = {
  id: "collection-story-1",
  index: 0,
  kind: "collection",
  title: "Scene Selects",
  childTimelineId: "scene-selects",
  itemCount: 12,
  alt: "Scene Selects collection",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 4,
  sourceDuration: 4,
  trimIn: 0,
  trimOut: 0,
};

type TimelineClipItemStoryArgs = TimelineClipItemMetrics &
  TimelineClipResizeHandlers &
  TimelineClipMediaActions &
  TimelineClipCollectionActions & {
    clip: TimelineClip;
    state?: TimelineClipItemState;
  };

const defaultResizeHandlers: TimelineClipResizeHandlers = {
  onResizeDown: () => {},
  onResizeMove: () => {},
  onResizeUp: () => {},
  onResizeKeyDown: () => {},
};

function getProviderValue(args: TimelineClipItemStoryArgs): TimelineClipItemContextValue {
  return {
    metrics: {
      pixelsPerSecond: args.pixelsPerSecond,
      itemTop: args.itemTop,
      itemHeight: args.itemHeight,
      gridMetrics: args.gridMetrics,
      thumbnailMode: args.thumbnailMode,
      thumbnailWidth: args.thumbnailWidth,
      thumbnailGap: args.thumbnailGap,
    },
    resizeHandlers: {
      onResizeDown: args.onResizeDown,
      onResizeMove: args.onResizeMove,
      onResizeUp: args.onResizeUp,
      onResizeKeyDown: args.onResizeKeyDown,
    },
    mediaActions: {
      onDurationLoaded: args.onDurationLoaded,
    },
    collectionActions: {
      getCollectionHref: args.getCollectionHref,
      onOpenCollection: args.onOpenCollection,
      onToggleCollectionExpanded: args.onToggleCollectionExpanded,
      onToggleCollectionEndpoint: args.onToggleCollectionEndpoint,
    },
  };
}

function TimelineClipItemStory(args: TimelineClipItemStoryArgs) {
  return (
    <TimelineClipItemProvider value={getProviderValue(args)}>
      <TimelineClipItem clip={args.clip} state={args.state} />
    </TimelineClipItemProvider>
  );
}

const meta = {
  title: "UI/Timeline/TimelineClipItem",
  component: TimelineClipItemStory,
  decorators: [
    (Story) => (
      <div
        className="font-sans text-white"
        style={{
          position: "relative",
          width: "100%",
          height: 300,
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
    clip: imageClip,
    pixelsPerSecond: 100,
    itemTop: 44,
    itemHeight: 200,
    state: {},
    ...defaultResizeHandlers,
  },
} satisfies Meta<typeof TimelineClipItemStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ImageDefault: Story = {
  args: { clip: imageClip },
};

export const VideoDefault: Story = {
  args: { clip: videoClip },
};

export const ImageSelected: Story = {
  args: {
    clip: imageClip,
    state: { isSelected: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const leftHandle = await canvas.findByTestId("timeline-trim-left");
    const rightHandle = await canvas.findByTestId("timeline-trim-right");
    expect(leftHandle).toBeInTheDocument();
    expect(rightHandle).toBeInTheDocument();
  },
};

export const VideoSelected: Story = {
  args: {
    clip: videoClip,
    state: { isSelected: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const leftHandle = await canvas.findByTestId("timeline-trim-left");
    const rightHandle = await canvas.findByTestId("timeline-trim-right");
    expect(leftHandle).toBeInTheDocument();
    expect(rightHandle).toBeInTheDocument();
  },
};

export const MissingPoster: Story = {
  args: {
    clip: { ...videoClip, poster: undefined },
  },
};

export const VideoWithScrubPreview: Story = {
  args: {
    clip: videoClip,
    state: { isSelected: true, scrubPreviewTime: 4.5 },
  },
};

export const GrowingOpposite: Story = {
  args: {
    clip: imageClip,
    state: { isSelected: true, isGrowingOpposite: true },
  },
};

export const ReorderPreview: Story = {
  args: {
    clip: imageClip,
    state: {
      isReordering: true,
      reorderPreview: {
        activeClipId: imageClip.id,
        dragLeft: 0,
        dragTop: 0,
        dragOffsetY: 0,
        targetIndex: 1,
        clientX: 180,
        clientY: 150,
        pointerOffsetX: 48,
        pointerOffsetY: 36,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sourceClip = await canvas.findByTestId("timeline-clip-0");
    expect(sourceClip).toHaveAttribute("data-reordering", "true");

    const body = within(document.body);
    expect(await body.findByTestId("timeline-reorder-preview")).toBeInTheDocument();
  },
};

export const ShortClip: Story = {
  args: {
    clip: makeImageClip(0, { duration: 0.5, sourceDuration: 0.5 }),
  },
};

export const LongClip: Story = {
  args: {
    clip: makeImageClip(0, { duration: 60, sourceDuration: 60 }),
    pixelsPerSecond: 10,
  },
};

export const RepeatedThumbnails: Story = {
  args: {
    clip: makeImageClip(0, { duration: 20, sourceDuration: 20 }),
    itemTop: 0,
  },
};

export const ThumbnailMode: Story = {
  args: {
    clip: makeImageClip(0),
    thumbnailMode: true,
    thumbnailWidth: THUMB_W,
    thumbnailGap: THUMB_GAP,
    itemTop: 0,
    itemHeight: 120,
  },
};

export const ThumbnailModeSelected: Story = {
  args: {
    clip: makeImageClip(0),
    thumbnailMode: true,
    thumbnailWidth: THUMB_W,
    thumbnailGap: THUMB_GAP,
    itemTop: 0,
    itemHeight: 120,
    state: { isSelected: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByTestId("timeline-trim-left")).not.toBeInTheDocument();
    expect(canvas.queryByTestId("timeline-trim-right")).not.toBeInTheDocument();
  },
};

export const ManyItems: Story = {
  args: {
    clip: makeImageClip(0),
    thumbnailMode: true,
    thumbnailWidth: THUMB_W,
    thumbnailGap: THUMB_GAP,
    itemTop: 0,
    itemHeight: 120,
  },
  render: (args) => (
    <TimelineClipItemProvider value={getProviderValue(args)}>
      <div
        style={{
          position: "relative",
          width: 12 * (THUMB_W + THUMB_GAP),
          height: 120,
        }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <TimelineClipItem
            key={index}
            clip={makeImageClip(index)}
            state={args.state}
          />
        ))}
      </div>
    </TimelineClipItemProvider>
  ),
};

export const CollectionDefault: Story = {
  args: {
    clip: collectionClip,
  },
};

export const CollectionWithExpandToggle: Story = {
  args: {
    clip: collectionClip,
    onToggleCollectionExpanded: () => {},
    state: { isCollectionExpanded: false },
  },
};
