import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Timeline, TimelineProps } from './Timeline';

const meta = {
  title: 'UI/Timeline/Timeline',
  component: Timeline,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="w-full min-h-[300px] p-6 bg-zinc-950 flex items-center justify-center">
        <div className="w-full max-w-4xl">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof Timeline>;

export default meta;

type Story = StoryObj<typeof meta>;

// A stateful wrapper for the story to allow playhead updates
function InteractiveTimeline(props: TimelineProps) {
  const [time, setTime] = useState(props.currentTime);
  return (
    <Timeline
      {...props}
      currentTime={time}
      onCurrentTimeChange={setTime}
    />
  );
}

const mockTracks = [
  {
    id: 'video-track',
    name: 'Video Track',
    items: [
      {
        id: 'clip-1',
        label: 'Intro Scene',
        start: 0,
        duration: 8,
        color: 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200',
      },
      {
        id: 'clip-2',
        label: 'A-Roll Interview',
        start: 8,
        duration: 15,
        color: 'bg-emerald-600/30 border-emerald-500/50 text-emerald-200',
      },
      {
        id: 'clip-3',
        label: 'Outro Promo',
        start: 25,
        duration: 5,
        color: 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200',
      },
    ],
  },
  {
    id: 'audio-track-1',
    name: 'Background Music',
    items: [
      {
        id: 'bg-music',
        label: 'Ambient Beats.mp3',
        start: 2,
        duration: 26,
        color: 'bg-amber-600/30 border-amber-500/50 text-amber-200',
      },
    ],
  },
  {
    id: 'audio-track-2',
    name: 'Voiceover',
    items: [
      {
        id: 'vo-1',
        label: 'VO_Intro.wav',
        start: 0.5,
        duration: 6,
        color: 'bg-rose-600/30 border-rose-500/50 text-rose-200',
      },
      {
        id: 'vo-2',
        label: 'VO_Middle.wav',
        start: 9,
        duration: 12,
        color: 'bg-rose-600/30 border-rose-500/50 text-rose-200',
      },
    ],
  },
];

export const Default: Story = {
  render: (args) => <InteractiveTimeline {...args} />,
  args: {
    currentTime: 5.5,
    duration: 30,
    zoom: 15,
    tracks: mockTracks,
  },
};

export const HighZoom: Story = {
  render: (args) => <InteractiveTimeline {...args} />,
  args: {
    currentTime: 12.0,
    duration: 30,
    zoom: 25,
    tracks: mockTracks,
  },
};

export const Empty: Story = {
  render: (args) => <InteractiveTimeline {...args} />,
  args: {
    currentTime: 0,
    duration: 10,
    zoom: 20,
    tracks: [],
  },
};
