import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreviewWheelPlayer } from './PreviewWheelPlayer';
import type { SceneLaunchMediaItem } from './SceneLaunchPreviewWheelV3';

const createColorPlaceholder = (color: string, label: string) => {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};

const mockItem: SceneLaunchMediaItem = {
  id: 'item-1',
  clipId: 'c1',
  name: 'Desert Clip',
  type: 'video',
  previewUrl: 'https://remotion.media/video.mp4',
  posterUrl: createColorPlaceholder('#f59e0b', 'Desert Clip'),
  durationSeconds: 10,
};

const meta = {
  title: 'UI/WheelPicker/PreviewWheelPlayer',
  component: PreviewWheelPlayer,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="relative h-[480px] w-[500px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreviewWheelPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultPlayer: Story = {
  args: {
    isGallery: true,
    hidePreview: false,
    effectiveScrubSnapshot: {
      media: mockItem,
      sourceTimeSeconds: 3.5,
      timelineTimeSeconds: 3.5,
    },
    gridView: false,
    isPreviewPlaying: false,
    loopPreviewPlayback: false,
    playheadPositionRatio: 0.5,
    centeredIndex: 0,
    itemsCount: 5,
    selectedMediaId: 'item-1',
    showSelectedTrimOverlay: true,
    trimOverlayMediaId: 'item-1',
    galleryPreviewHeight: 270,
    galleryPreviewWidth: 480,
    totalDurationSeconds: 25,
    snapToIndex: () => {},
    centerPlayhead: () => {},
    renderGalleryTrimOverlay: () => (
      <div className="bg-zinc-900 border border-zinc-700 px-3 py-1 rounded text-[10px] text-zinc-300">
        Trim Overlay Active
      </div>
    ),
  },
};

export const PlayingPlayer: Story = {
  args: {
    ...DefaultPlayer.args,
    isPreviewPlaying: true,
  },
};
