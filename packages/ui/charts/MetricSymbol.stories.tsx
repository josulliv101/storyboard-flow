import type { Meta, StoryObj } from '@storybook/react';
import { MetricSymbol } from './MetricSymbol';

const metricExamples = [
  { name: 'Tension', color: '#f43f5e', value: 'Circle' },
  { name: 'Suspense', color: '#a855f7', value: 'Diamond' },
  { name: 'Anticipation', color: '#06b6d4', value: 'Triangle' },
  { name: 'Stakes', color: '#22c55e', value: 'Triangle alias' },
  { name: 'Momentum', color: '#f59e0b', value: 'Default square' },
];

const meta = {
  title: 'UI/Charts/MetricSymbol',
  component: MetricSymbol,
  args: {
    name: 'Tension',
  },
  decorators: [
    Story => (
      <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MetricSymbol>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: args => (
    <div className="flex items-center gap-3">
      <MetricSymbol
        {...args}
        className="h-12 w-12"
        style={{ color: '#f43f5e' }}
      />
      <div>
        <div className="text-sm font-semibold text-zinc-100">{args.name}</div>
        <div className="text-xs text-zinc-500">Uses currentColor for the SVG fill.</div>
      </div>
    </div>
  ),
};

export const AllMetrics: Story = {
  render: () => (
    <div className="grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
      {metricExamples.map(metric => (
        <div
          key={metric.name}
          className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/70 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <MetricSymbol
              name={metric.name}
              className="h-7 w-7"
              style={{ color: metric.color }}
            />
            <span className="text-sm font-semibold text-zinc-100">{metric.name}</span>
          </div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {metric.value}
          </span>
        </div>
      ))}
    </div>
  ),
};
