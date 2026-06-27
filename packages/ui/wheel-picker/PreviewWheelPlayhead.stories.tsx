import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreviewWheelPlayhead } from './PreviewWheelPlayhead';

const meta = {
  title: 'UI/WheelPicker/PreviewWheelPlayhead',
  component: PreviewWheelPlayhead,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-[500px] bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PreviewWheelPlayhead>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultPlayhead: Story = {
  args: {
    renderedPlayheadX: 250,
    itemTop: 20,
    itemHeight: 120,
    rulerPlayheadTimeSeconds: 4.5,
    isPlayheadDragging: false,
    beginPlayheadDrag: () => {},
    movePlayheadDrag: () => {},
    endPlayheadDrag: () => {},
    handlePlayheadKeyDown: () => {},
    shouldShowPlayhead: true,
    isSharedPlayheadPlaying: false,
    sizing: 'duration',
    isGallery: false,
    canNavigateBack: false,
  },
};

export const PlayingPlayhead: Story = {
  args: {
    ...DefaultPlayhead.args,
    isSharedPlayheadPlaying: true,
  },
};

export const PlayheadWithBackButton: Story = {
  args: {
    ...DefaultPlayhead.args,
    onNavigateBack: () => {},
    canNavigateBack: true,
    parentCollectionName: 'Project Assets',
  },
};
