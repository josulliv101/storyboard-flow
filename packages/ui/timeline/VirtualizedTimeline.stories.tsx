import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { VirtualizedTimeline, VirtualizedTimelineProps } from './VirtualizedTimeline';

const meta = {
  title: 'UI/Timeline/VirtualizedTimeline',
  component: VirtualizedTimeline,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="w-full min-h-[500px] p-6 bg-zinc-950 flex items-center justify-center">
        <div className="w-full max-w-4xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof VirtualizedTimeline>;

export default meta;

type Story = StoryObj<typeof meta>;

function InteractiveVirtualizedTimeline(props: VirtualizedTimelineProps) {
  const [time, setTime] = useState(props.currentTime);
  return (
    <VirtualizedTimeline
      {...props}
      currentTime={time}
      onCurrentTimeChange={setTime}
    />
  );
}

// Generate 500 tracks to demonstrate virtualization performance
const generateMockTracks = (count: number) => {
  const trackColors = [
    'bg-indigo-600/30 border-indigo-500/50 text-indigo-200',
    'bg-emerald-600/30 border-emerald-500/50 text-emerald-200',
    'bg-amber-600/30 border-amber-500/50 text-amber-200',
    'bg-rose-600/30 border-rose-500/50 text-rose-200',
    'bg-violet-600/30 border-violet-500/50 text-violet-200',
    'bg-sky-600/30 border-sky-500/50 text-sky-200',
  ];

  return Array.from({ length: count }).map((_, trackIndex) => {
    // Generate 1-3 clips per track
    const itemsCount = Math.floor(Math.random() * 3) + 1;
    const items = [];
    let currentStart = Math.random() * 5;

    for (let i = 0; i < itemsCount; i++) {
      const duration = Math.random() * 10 + 2;
      const color = trackColors[(trackIndex + i) % trackColors.length];
      items.push({
        id: `track-${trackIndex}-clip-${i}`,
        label: `Track ${trackIndex + 1} - Clip ${i + 1}`,
        start: currentStart,
        duration: duration,
        color: color,
      });
      currentStart += duration + Math.random() * 5;
    }

    return {
      id: `track-${trackIndex}`,
      name: `Track ${trackIndex + 1}`,
      items,
    };
  });
};

export const PerformanceTest500Tracks: Story = {
  render: (args) => <InteractiveVirtualizedTimeline {...args} />,
  args: {
    currentTime: 10,
    duration: 100,
    zoom: 15,
    tracks: generateMockTracks(500),
    height: 500,
  },
};

export const ModerateTracks: Story = {
  render: (args) => <InteractiveVirtualizedTimeline {...args} />,
  args: {
    currentTime: 2,
    duration: 60,
    zoom: 12,
    tracks: generateMockTracks(30),
    height: 350,
  },
};
