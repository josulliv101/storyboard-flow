import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SmoothScrollList } from './SmoothScrollList';

const meta = {
  title: 'UI/Timeline/SmoothScrollExample',
  component: SmoothScrollList,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-full min-h-[550px] p-6 bg-zinc-950 flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SmoothScrollList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    itemCount: 1002,
    // height: 350,
  },
};
