import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TimelineRuler } from './TimelineRuler';

const meta = {
  title: 'UI/WheelPicker/TimelineRuler',
  component: TimelineRuler,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="relative h-20 w-96 bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TimelineRuler>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultRulerTicks: Story = {
  args: {
    itemWidth: 200,
    itemStartTime: 0,
    itemDuration: 10,
    itemEndTime: 10,
    rulerTickStep: 2,
    rulerTop: 10,
    opacity: 1,
    effect: 'gallery',
    x: 100,
    z: 0,
    rotateY: 0,
    scale: 1,
    distance: 0,
    isLastItem: true,
  },
};

export const SkewedRulerTicks3D: Story = {
  args: {
    itemWidth: 150,
    itemStartTime: 10,
    itemDuration: 8,
    itemEndTime: 18,
    rulerTickStep: 2,
    rulerTop: 5,
    opacity: 0.6,
    effect: 'cylinder',
    x: 50,
    z: -30,
    rotateY: -20,
    scale: 0.9,
    distance: 1.5,
    isLastItem: false,
  },
};
