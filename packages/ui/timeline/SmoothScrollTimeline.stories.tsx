import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SmoothScrollList } from './SmoothScrollList';

const StoryShell = ({
  children,
  maxWidth = '100%',
  description,
}: {
  children: React.ReactNode;
  maxWidth?: number | string;
  description?: string;
}) => (
  <div className="min-h-[560px] w-full bg-zinc-950 p-6 text-zinc-100">
    <div className="mx-auto flex w-full flex-col gap-3" style={{ maxWidth }}>
      {description ? (
        <p className="max-w-3xl text-xs leading-relaxed text-zinc-400">{description}</p>
      ) : null}
      {children}
    </div>
  </div>
);

const meta = {
  title: 'UI/Timeline/SmoothScrollExample',
  component: SmoothScrollList,
  parameters: {
    layout: 'fullscreen',
    controls: {
      expanded: true,
    },
    docs: {
      description: {
        component:
          'Interactive horizontal timeline used to validate scrolling, trim handles, selected-video filmstrip controls, no-autoplay video previews, repeated video frames, and large item counts.',
      },
    },
  },
  decorators: [
    (Story) => (
      <StoryShell>
        <Story />
      </StoryShell>
    ),
  ],
  argTypes: {
    itemCount: {
      control: { type: 'number', min: 0, max: 5000, step: 1 },
      description: 'Number of timeline clips to generate.',
    },
    viewportWidth: {
      control: 'text',
      description: 'Optional width for the scroll viewport. Defaults to full width.',
    },
    pixelsPerSecond: {
      control: { type: 'number', min: 20, max: 300, step: 10 },
      description: 'Timeline scale used by trim/source-duration math.',
    },
    width: {
      table: {
        disable: true,
      },
    },
  },
  args: {
    viewportWidth: '100%',
    pixelsPerSecond: 100,
  },
} satisfies Meta<typeof SmoothScrollList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: 'Default / many items',
  args: {
    itemCount: 1002,
  },
};

export const FullWidthLayout: Story = {
  name: 'Full-width layout',
  args: {
    itemCount: 120,
    viewportWidth: '100%',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Verifies the component, controls, buttons, scrollbar, and visible timeline area fill the available width without clipping.',
      },
    },
  },
};

export const FewItemsStillFillWidth: Story = {
  name: 'Few items still fill width',
  args: {
    itemCount: 6,
    viewportWidth: '100%',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Checks that a short timeline still has a full-width viewport and does not collapse around the first few clips.',
      },
    },
  },
};

export const NarrowViewport: Story = {
  name: 'Narrow viewport / responsive controls',
  args: {
    itemCount: 80,
    viewportWidth: 360,
  },
  render: (args) => (
    <div className="flex max-w-[460px] flex-col gap-3">
      <p className="max-w-3xl text-xs leading-relaxed text-zinc-400">
        The buttons should wrap cleanly, remain visible, and the horizontal scrollbar should still be available.
      </p>
      <SmoothScrollList {...args} />
    </div>
  ),
};

export const SelectedVideoFilmstripControls: Story = {
  name: 'Selected video + filmstrip controls',
  args: {
    itemCount: 36,
    viewportWidth: '100%',
  },
  render: (args) => (
    <>
      <p className="max-w-3xl text-xs leading-relaxed text-zinc-400">
        Click a video clip to select it. The video should not autoplay. A narrow full-source filmstrip
        should appear above the selected clip; dragging the filmstrip window changes the source in/out
        area while dragging the clip body scrolls the timeline.
      </p>
      <SmoothScrollList {...args} />
    </>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Manual interaction coverage for selected video state, no-autoplay behavior, filmstrip source-window movement, and timeline drag behavior on the selected item body.',
      },
    },
  },
};

export const TrimHandleScrubPreview: Story = {
  name: 'Trim handles scrub preview',
  args: {
    itemCount: 36,
    viewportWidth: '100%',
  },
  render: (args) => (
    <>
      <p className="max-w-3xl text-xs leading-relaxed text-zinc-400">
        Select a video clip, then drag either trim handle. The displayed frame should scrub to the
        left in-point or right out-point in real time, then remain aligned to the current start frame
        when released.
      </p>
      <SmoothScrollList {...args} />
    </>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Covers left and right trim-handle scrubbing, especially right-handle out-point timing sync.',
      },
    },
  },
};

export const WideVideoRepeatedFrames: Story = {
  name: 'Wide video repeated frames',
  args: {
    itemCount: 24,
    viewportWidth: '100%',
  },
  render: (args) => (
    <>
      <p className="max-w-3xl text-xs leading-relaxed text-zinc-400">
        Select a video clip and drag a trim handle wider. Once the clip becomes very wide, the frame
        display should split into an odd number of repeated frames with one centered frame and dimmed
        side frames.
      </p>
      <SmoothScrollList {...args} />
    </>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Manual stress coverage for MAX_WIDTH=1800, odd-number repeated video frames, centered primary frame, and dimmed non-centered frames.',
      },
    },
  },
};

export const TimelineScaleLow: Story = {
  name: 'Low timeline scale',
  args: {
    itemCount: 120,
    viewportWidth: '100%',
    pixelsPerSecond: 60,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Checks trim/source-duration math at a lower pixels-per-second value.',
      },
    },
  },
};

export const TimelineScaleHigh: Story = {
  name: 'High timeline scale',
  args: {
    itemCount: 120,
    viewportWidth: '100%',
    pixelsPerSecond: 180,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Checks trim/source-duration math and scrollbar behavior at a higher pixels-per-second value.',
      },
    },
  },
};

export const LargeDataSet: Story = {
  name: 'Large data set / virtualization window',
  args: {
    itemCount: 2500,
    viewportWidth: '100%',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Performance scenario for many timeline items. The rendered count badge should stay much lower than the total item count.',
      },
    },
  },
};

export const Empty: Story = {
  name: 'Empty timeline',
  args: {
    itemCount: 0,
    viewportWidth: '100%',
  },
};