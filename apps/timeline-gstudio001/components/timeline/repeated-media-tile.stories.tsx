import type { Meta, StoryObj } from '@storybook/react';

import { RepeatedMediaTile } from './repeated-media-tile';
import type { TimelineClip } from './types';

/* ------------------------------------------------------------------ */
/*  Helper clips                                                       */
/* ------------------------------------------------------------------ */

const imageClip: TimelineClip = {
  id: 'img-1',
  index: 0,
  kind: 'image',
  src: 'https://picsum.photos/seed/timeline-1/400/200',
  alt: 'Sample image',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

const videoClip: TimelineClip = {
  id: 'vid-1',
  index: 1,
  kind: 'video',
  src: 'https://www.w3schools.com/html/mov_bbb.mp4',
  alt: 'Sample video',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 3,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

/* ------------------------------------------------------------------ */
/*  Meta                                                               */
/* ------------------------------------------------------------------ */

const meta: Meta<typeof RepeatedMediaTile> = {
  title: 'GStudio/Timeline/RepeatedMediaTile',
  component: RepeatedMediaTile,
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 500,
          height: 200,
          background: '#27272a',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    onDurationLoaded: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof RepeatedMediaTile>;

/* ------------------------------------------------------------------ */
/*  Stories                                                             */
/* ------------------------------------------------------------------ */

/** Default image clip rendered at full container width. */
export const ImageClip: Story = {
  args: {
    clip: imageClip,
    displayWidth: 500,
    previewTime: 0,
    itemHeight: 200,
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

/** Narrow container — fewer repeated tiles visible. */
export const NarrowWidth: Story = {
  args: {
    clip: imageClip,
    displayWidth: 200,
    previewTime: 0,
    itemHeight: 200,
  },
};

/** Wide container — more repeated tiles visible. */
export const WideWidth: Story = {
  args: {
    clip: imageClip,
    displayWidth: 800,
    previewTime: 0,
    itemHeight: 200,
  },
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: 800,
          height: 200,
          background: '#27272a',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
};

/** Shorter item height — tiles scale down vertically. */
export const SmallHeight: Story = {
  args: {
    clip: imageClip,
    displayWidth: 500,
    previewTime: 0,
    itemHeight: 120,
  },
};
