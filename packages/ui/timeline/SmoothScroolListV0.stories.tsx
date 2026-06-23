import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { SmoothScrollListV0 } from './SmoothScrollListV0';

const meta = {
    title: 'UI/Timeline/SmoothScrollListV0',
    component: SmoothScrollListV0,
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
} satisfies Meta<typeof SmoothScrollListV0>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
    args: {
        itemCount: 1002,
        // width: 600,
    },
};
