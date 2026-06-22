import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreviewWheelGridView } from './PreviewWheelGridView';
import type { SceneLaunchMediaItem } from './SceneLaunchPreviewWheelV3';

const createColorPlaceholder = (color: string, label: string) => {
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="225" viewBox="0 0 400 225"><rect width="100%" height="100%" fill="${encodeURIComponent(color)}"/><text x="50%" y="50%" fill="%23fff" font-family="sans-serif" font-weight="black" font-size="24" text-anchor="middle" dominant-baseline="middle">${encodeURIComponent(label)}</text></svg>`;
};

const mockMedia: SceneLaunchMediaItem = {
  id: 'item-1',
  clipId: 'c1',
  name: 'Ocean Coast',
  type: 'image',
  previewUrl: createColorPlaceholder('#3b82f6', 'Ocean Coast'),
};

const meta = {
  title: 'UI/WheelPicker/PreviewWheelGridView',
  component: PreviewWheelGridView,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="relative w-full h-[600px] bg-zinc-950 p-6 overflow-auto">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreviewWheelGridView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultGrid: Story = {
  args: {
    wrappedRows: [
      {
        items: [
          { ...mockMedia, id: 'item-1', name: 'Item 1', previewUrl: createColorPlaceholder('#ef4444', 'Item 1') },
          { ...mockMedia, id: 'item-2', name: 'Item 2', previewUrl: createColorPlaceholder('#f59e0b', 'Item 2') },
        ],
        parentChunkIndex: 0,
        subRowIndex: 0,
        isIndented: false,
        nestingLevel: 0,
        rowTitle: 'Main Collection',
        rowIsCollection: false,
      },
      {
        items: [
          { ...mockMedia, id: 'item-3', name: 'Item 3', previewUrl: createColorPlaceholder('#10b981', 'Item 3') },
        ],
        parentChunkIndex: 1,
        subRowIndex: 0,
        isIndented: true,
        nestingLevel: 1,
        rowTitle: 'Sub-Folder Assets',
        rowIsCollection: true,
      }
    ],
    hidePreview: true,
    selectedMediaId: 'item-1',
    effect: 'gallery',
    durationScale: 1,
    itemsPerRow: 3,
    visibleGridPlayheadRow: 0,
    activePlayingMediaId: null,
    activePlayingElapsedSeconds: 0,
    onCenteredMediaChange: () => {},
    handleGridScrubUpdate: () => {},
  },
};
