import type { Meta, StoryObj } from '@storybook/react';
import { VideoSourceFilmStrip } from './video-source-filmstrip';
import type { TimelineClip } from './types';

const videoClip: TimelineClip = {
  id: 'filmstrip-vid-1',
  index: 0,
  kind: 'video',
  src: 'https://www.w3schools.com/html/mov_bbb.mp4',
  alt: 'Big Buck Bunny',
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 5,
  sourceDuration: 10,
  trimIn: 2,
  trimOut: 3,
};

const untrimmedClip: TimelineClip = {
  ...videoClip,
  id: 'filmstrip-vid-2',
  duration: 10,
  sourceDuration: 10,
  trimIn: 0,
  trimOut: 0,
};

const meta: Meta<typeof VideoSourceFilmStrip> = {
  title: 'GStudio/Timeline/VideoSourceFilmStrip',
  component: VideoSourceFilmStrip,
  decorators: [
    (Story) => (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 80,
          background: '#09090b',
          borderRadius: 8,
          overflow: 'visible',
          padding: '20px 40px',
        }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    pixelsPerSecond: 100,
    onSourceWindowPointerDown: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof VideoSourceFilmStrip>;

/** Default trimmed clip — selection window is narrower than the full filmstrip. */
export const Default: Story = {
  args: {
    clip: videoClip,
  },
};

/** Untrimmed clip — selection window spans the full filmstrip width. */
export const Untrimmed: Story = {
  args: {
    clip: untrimmedClip,
  },
};

/** Heavily trimmed clip — only 2 s visible out of a 10 s source. */
export const HeavilyTrimmed: Story = {
  args: {
    clip: {
      ...videoClip,
      id: 'filmstrip-vid-3',
      duration: 2,
      trimIn: 4,
      trimOut: 4,
    },
  },
};

/** Editing in "move" mode — the selection window should show the move cursor style. */
export const EditingMoveMode: Story = {
  args: {
    clip: videoClip,
    editingMode: 'move',
  },
};

/** Thumbnail mode with a wider thumbnail width. */
export const ThumbnailMode: Story = {
  args: {
    clip: videoClip,
    thumbnailMode: true,
    thumbnailWidth: 355,
  },
};
