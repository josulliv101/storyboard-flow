import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TensionChart, type ChartDataPoint } from './TensionChart';

const sampleData: ChartDataPoint[] = [
  { name: 'Cold Open', tension: 1.2, suspense: 2.5, anticipation: 1.6, sceneIndex: 0, timestamp: 0 },
  { name: 'Signal Found', tension: 2.4, suspense: 3.3, anticipation: 2.8, sceneIndex: 1, timestamp: 38 },
  { name: 'False Lead', tension: 2.9, suspense: 4.1, anticipation: 3.2, sceneIndex: 2, timestamp: 82 },
  { name: 'Door Opens', tension: 4.2, suspense: 4.8, anticipation: 3.9, sceneIndex: 3, timestamp: 126 },
  { name: 'Quiet Beat', tension: 2.7, suspense: 3.5, anticipation: 4.4, sceneIndex: 4, timestamp: 171 },
  { name: 'Choice Point', tension: 3.8, suspense: 3.7, anticipation: 4.9, sceneIndex: 5, timestamp: 218 },
  { name: 'Reveal', tension: 5, suspense: 4.6, anticipation: 3.5, sceneIndex: 6, timestamp: 261 },
  { name: 'Aftermath', tension: 2.1, suspense: 1.8, anticipation: 2.4, sceneIndex: 7, timestamp: 312 },
];

type ChartStoryProps = React.ComponentProps<typeof TensionChart>;

function ChartFrame(props: Partial<ChartStoryProps>) {
  const [activeIndex, setActiveIndex] = React.useState(props.activeIndex ?? 2);

  return (
    <div className="flex min-h-screen items-start bg-[#080809] p-8 text-zinc-100">
      <div className="mx-auto w-full max-w-5xl">
        <TensionChart
          data={sampleData}
          activeIndex={activeIndex}
          onSelectScene={setActiveIndex}
          {...props}
        />
      </div>
    </div>
  );
}

function EditableChartFrame() {
  const [data, setData] = React.useState(sampleData);
  const [activeIndex, setActiveIndex] = React.useState(3);

  return (
    <div className="flex min-h-screen items-start bg-[#080809] p-8 text-zinc-100">
      <div className="mx-auto w-full max-w-5xl">
        <TensionChart
          data={data}
          activeIndex={activeIndex}
          onSelectScene={setActiveIndex}
          onUpdateValue={(sceneIndex, metric, newValue) => {
            setData(current =>
              current.map(point =>
                point.sceneIndex === sceneIndex
                  ? { ...point, [metric]: newValue }
                  : point,
              ),
            );
          }}
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'UI/Charts/TensionChart',
  component: ChartFrame,
  parameters: {
    layout: 'fullscreen',
    controls: {
      expanded: false,
    },
  },
} satisfies Meta<typeof ChartFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllMetrics: Story = {
  render: () => <ChartFrame />,
};

export const TensionOnly: Story = {
  render: () => <ChartFrame activeTab="graph-tension" activeIndex={6} />,
};

export const CustomColors: Story = {
  render: () => (
    <ChartFrame
      activeIndex={5}
      colors={{
        tension: '#fb7185',
        suspense: '#c084fc',
        anticipation: '#2dd4bf',
      }}
    />
  ),
};

export const EditableValues: Story = {
  render: () => <EditableChartFrame />,
};
