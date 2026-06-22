import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { UniformItemProgress } from './UniformItemProgress';

const meta = {
  title: 'UI/WheelPicker/UniformItemProgress',
  component: UniformItemProgress,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="relative h-20 w-80 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center text-zinc-400 text-xs font-mono">
        <span>Timeline Media Item Container</span>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UniformItemProgress>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Paused: Story = {
  args: {
    progress: 0.35,
    durationSeconds: 10,
    isPlaying: false,
    timelineTimeSeconds: 3.5,
  },
};

export const Playing: Story = {
  args: {
    progress: 0.1,
    durationSeconds: 5,
    isPlaying: true,
    timelineTimeSeconds: 0.5,
  },
};
