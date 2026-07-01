import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';

import { TimelineClipItem } from './TimelineClipItem';
import type { CollectionTimelineClip, ImageTimelineClip, TimelineClip } from './types';

/* ---------------------------------------------------------------------------
 * Static placeholder assets — no live network calls
 * --------------------------------------------------------------------------- */

const PLACEHOLDER_IMG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%23334155'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EImage%3C%2Ftext%3E%3C/svg%3E";

const PLACEHOLDER_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='225'%3E%3Crect width='400' height='225' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-family='sans-serif' font-size='14'%3EPoster%3C%2Ftext%3E%3C/svg%3E";

/* ---------------------------------------------------------------------------
 * Fixture helpers
 * --------------------------------------------------------------------------- */

const THUMB_W = 160;
const THUMB_GAP = 12;

function makeImageClip(index: number, overrides?: Partial<ImageTimelineClip>): ImageTimelineClip {
  return {
    id: `img-story-${index}`,
    index,
    kind: 'image',
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
  id: 'vid-story-1',
  index: 0,
  kind: 'video',
  src: '',
  poster: PLACEHOLDER_POSTER,
  alt: 'Sample video',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

const collectionClip: CollectionTimelineClip = {
  id: 'collection-story-1',
  index: 0,
  kind: 'collection',
  title: 'Scene Selects',
  childTimelineId: 'scene-selects',
  itemCount: 12,
  alt: 'Scene Selects collection',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 4,
  sourceDuration: 4,
  trimIn: 0,
  trimOut: 0,
};

/* ---------------------------------------------------------------------------
 * Meta
 * --------------------------------------------------------------------------- */

const meta: Meta<typeof TimelineClipItem> = {
  title: 'UI/Timeline/TimelineClipItem',
  component: TimelineClipItem,
  decorators: [
    (Story) => (
      <div
        className="font-sans text-white"
        style={{
          position: 'relative',
          width: '100%',
          height: 300,
          background: '#09090b',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    pixelsPerSecond: 100,
    itemTop: 44,
    itemHeight: 200,
    isSelected: false,
    onResizeDown: () => {},
    onResizeMove: () => {},
    onResizeUp: () => {},
    onResizeKeyDown: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof TimelineClipItem>;

/* ---------------------------------------------------------------------------
 * Default / unselected
 * --------------------------------------------------------------------------- */

/** Image clip in its default, unselected state. */
export const ImageDefault: Story = {
  args: { clip: imageClip },
};

/** Video clip in its default, unselected state — shows the VIDEO badge. */
export const VideoDefault: Story = {
  args: { clip: videoClip },
};

/* ---------------------------------------------------------------------------
 * Selected state — trim handles
 * --------------------------------------------------------------------------- */

/** Image clip when selected. Trim handles must appear on left and right edges. */
export const ImageSelected: Story = {
  args: {
    clip: imageClip,
    isSelected: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const leftHandle = await canvas.findByTestId('timeline-trim-left');
    const rightHandle = await canvas.findByTestId('timeline-trim-right');
    expect(leftHandle).toBeInTheDocument();
    expect(rightHandle).toBeInTheDocument();
  },
};

/** Video clip when selected — trim handles and VIDEO badge both visible. */
export const VideoSelected: Story = {
  args: {
    clip: videoClip,
    isSelected: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const leftHandle = await canvas.findByTestId('timeline-trim-left');
    const rightHandle = await canvas.findByTestId('timeline-trim-right');
    expect(leftHandle).toBeInTheDocument();
    expect(rightHandle).toBeInTheDocument();
  },
};

/* ---------------------------------------------------------------------------
 * Missing poster fallback
 * --------------------------------------------------------------------------- */

/** Video clip with no poster — tile renders without an image fallback. */
export const MissingPoster: Story = {
  args: {
    clip: { ...videoClip, poster: undefined },
  },
};

/* ---------------------------------------------------------------------------
 * Scrub preview
 * --------------------------------------------------------------------------- */

/** Selected video clip with an active scrub preview time. */
export const VideoWithScrubPreview: Story = {
  args: {
    clip: videoClip,
    isSelected: true,
    scrubPreviewTime: 4.5,
  },
};

/* ---------------------------------------------------------------------------
 * Growing-opposite resize
 * --------------------------------------------------------------------------- */

/** Image clip in the "growing opposite" resize state. */
export const GrowingOpposite: Story = {
  args: {
    clip: imageClip,
    isSelected: true,
    isGrowingOpposite: true,
  },
};

/** Image clip during pointer reorder. The source tile dims while a floating preview renders in a portal. */
export const ReorderPreview: Story = {
  args: {
    clip: imageClip,
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sourceClip = await canvas.findByTestId('timeline-clip-0');
    expect(sourceClip).toHaveAttribute('data-reordering', 'true');

    const body = within(document.body);
    expect(await body.findByTestId('timeline-reorder-preview')).toBeInTheDocument();
  },
};

/* ---------------------------------------------------------------------------
 * Short and long clips
 * --------------------------------------------------------------------------- */

/** Very short clip (0.5 s) — verifies the clip renders even at minimal width. */
export const ShortClip: Story = {
  args: {
    clip: makeImageClip(0, { duration: 0.5, sourceDuration: 0.5 }),
  },
};

/** Long clip (60 s) at a reduced pixels-per-second so it fits the viewport. */
export const LongClip: Story = {
  args: {
    clip: makeImageClip(0, { duration: 60, sourceDuration: 60 }),
    pixelsPerSecond: 10,
  },
};

/* ---------------------------------------------------------------------------
 * Repeated thumbnails
 * --------------------------------------------------------------------------- */

/**
 * Wide image clip — enough room to tile the thumbnail multiple times.
 * Verifies the RepeatedMediaTile renders repeated frames without overflow.
 */
export const RepeatedThumbnails: Story = {
  args: {
    clip: makeImageClip(0, { duration: 20, sourceDuration: 20 }),
    itemTop: 0,
  },
};

/* ---------------------------------------------------------------------------
 * Thumbnail mode
 * --------------------------------------------------------------------------- */

/** Single image clip in thumbnail-grid mode. */
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

/** Thumbnail mode with selection ring (no trim handles in this mode). */
export const ThumbnailModeSelected: Story = {
  args: {
    clip: makeImageClip(0),
    thumbnailMode: true,
    thumbnailWidth: THUMB_W,
    thumbnailGap: THUMB_GAP,
    itemTop: 0,
    itemHeight: 120,
    isSelected: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Trim handles must NOT appear in thumbnail mode.
    expect(canvas.queryByTestId('timeline-trim-left')).not.toBeInTheDocument();
    expect(canvas.queryByTestId('timeline-trim-right')).not.toBeInTheDocument();
  },
};

/* ---------------------------------------------------------------------------
 * Many items — thumbnail grid with 12 clips side-by-side
 * --------------------------------------------------------------------------- */

/** Twelve clips in thumbnail mode — verifies layout at high item counts. */
export const ManyItems: Story = {
  args: {
    clip: makeImageClip(0),
    thumbnailMode: true,
    thumbnailWidth: THUMB_W,
    thumbnailGap: THUMB_GAP,
    itemTop: 0,
    itemHeight: 120,
  },
  decorators: [
    (_Story, ctx) => (
      <div
        className="font-sans text-white"
        style={{
          position: 'relative',
          width: '100%',
          height: 120,
          background: '#09090b',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        <div style={{ position: 'relative', width: 12 * (THUMB_W + THUMB_GAP), height: 120 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <TimelineClipItem
              key={i}
              {...ctx.args}
              clip={makeImageClip(i)}
            />
          ))}
        </div>
      </div>
    ),
  ],
};

/* ---------------------------------------------------------------------------
 * Collection
 * --------------------------------------------------------------------------- */

/** Collection clip in default state — shows COLLECTION badge and item count. */
export const CollectionDefault: Story = {
  args: {
    clip: collectionClip,
  },
};

/** Collection clip with the expand toggle button. */
export const CollectionWithExpandToggle: Story = {
  args: {
    clip: collectionClip,
    onToggleCollectionExpanded: () => {},
    isCollectionExpanded: false,
  },
};
