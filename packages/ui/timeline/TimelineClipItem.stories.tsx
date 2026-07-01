import type { Meta, StoryObj } from '@storybook/react';

import { TimelineClipItem } from './TimelineClipItem';
import type { TimelineClip } from './types';

/* ---------------------------------------------------------------------------
 * Helper fixtures
 * --------------------------------------------------------------------------- */

const storyVideoSrc = 'https://res.cloudinary.com/demo/video/upload/dog.mp4';

const imageClip: TimelineClip = {
  id: 'img-story-1',
  index: 0,
  kind: 'image',
  src: 'https://picsum.photos/seed/clip-1/400/200',
  alt: 'Mountain landscape',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

const videoClip: TimelineClip = {
  id: 'vid-story-1',
  index: 1,
  kind: 'video',
  src: storyVideoSrc,
  poster: 'https://res.cloudinary.com/demo/video/upload/so_0,w_480,h_270,c_fill,q_auto,f_jpg/dog.jpg',
  alt: 'Big Buck Bunny',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 3.12,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
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
 * Stories
 * --------------------------------------------------------------------------- */

/** An image clip in its default, unselected state. */
export const ImageDefault: Story = {
  args: {
    clip: imageClip,
  },
};

/** An image clip when selected — trim handles should appear. */
export const ImageSelected: Story = {
  args: {
    clip: imageClip,
    isSelected: true,
  },
};

/** A video clip in its default, unselected state — shows the VIDEO label. */
export const VideoDefault: Story = {
  args: {
    clip: videoClip,
  },
};

/** A video clip when selected — trim handles and VIDEO label visible. */
export const VideoSelected: Story = {
  args: {
    clip: videoClip,
    isSelected: true,
  },
};

/** A selected video clip with a scrub preview time indicator. */
export const VideoWithScrubPreview: Story = {
  args: {
    clip: videoClip,
    isSelected: true,
    scrubPreviewTime: 4.5,
  },
};

/** An image clip in the "growing opposite" resize state. */
export const GrowingOpposite: Story = {
  args: {
    clip: imageClip,
    isSelected: true,
    isGrowingOpposite: true,
  },
};

/** An image clip rendered in thumbnail mode with explicit width and gap. */
export const ThumbnailMode: Story = {
  args: {
    clip: imageClip,
    thumbnailMode: true,
    thumbnailWidth: 355,
    thumbnailGap: 16,
  },
};
