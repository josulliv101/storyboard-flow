import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import {
  aspectRatioOptions,
  getAspectRatioSpec,
  ResponsiveAspectFrame,
  type AspectRatioKey,
} from './ResponsiveAspectFrame';

type ContractGroup = {
  id: string;
  mediaItems: string[];
  graphItems: string[];
  showDialogGridItem?: boolean;
};

type DialogPreviewLayoutContractProps = {
  groups: ContractGroup[];
  aspectRatio: AspectRatioKey;
};

const defaultAspectRatio: AspectRatioKey = '16:9';
const pct = (value: number) => `${value}%`;

function getAspectRatio(aspectRatio: AspectRatioKey = defaultAspectRatio) {
  return getAspectRatioSpec(aspectRatio);
}

function GraphPanel({ items }: { items: string[] }) {
  return (
    <div
      data-testid="graph-cell-content"
      className="flex h-full w-full min-w-0 flex-col gap-2 overflow-hidden rounded border border-purple-400/40 bg-black/75 p-2"
    >
      {items.map((item, index) => (
        <div
          key={item}
          data-testid="graph-card"
          className="min-w-0 overflow-hidden rounded border border-purple-400/25 bg-black/70 p-2"
        >
          <div className="mb-1 truncate text-[10px] font-black uppercase tracking-widest text-cyan-300">
            {item}
          </div>
          <div className="relative h-8 overflow-hidden rounded bg-white/[0.04]">
            <div className="absolute bottom-0 left-0 h-2 w-full bg-cyan-500/25" />
            <div
              className="absolute bottom-0 h-full w-px bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]"
              style={{ left: pct(18 + index * 22) }}
            />
            <div
              className="absolute h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[9px] border-x-transparent border-b-cyan-300"
              style={{ left: pct(34 + index * 12), top: pct(34) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ContractFrame({
  aspectRatio,
  group,
  index,
}: {
  aspectRatio: AspectRatioKey;
  group: ContractGroup;
  index: number;
}) {
  const usesDialogGridItem = group.showDialogGridItem === true;
  const visualWidth = usesDialogGridItem ? 66.6667 : 100;
  const mediaWidth = visualWidth / Math.max(1, group.mediaItems.length);

  return (
    <ResponsiveAspectFrame
      aspectRatio={aspectRatio}
      cellClassName="flex h-full min-h-0 min-w-0 items-center justify-center"
      cellTestId="group-cell"
      frameClassName="relative overflow-hidden rounded border border-white/10 bg-zinc-950 shadow-2xl"
      frameDataAttributes={{ 'data-group-index': index }}
      frameTestId="group-frame"
    >
      {group.mediaItems.map((label, mediaIndex) => (
        <div
          key={label}
          data-testid="media-grid-item"
          className="absolute top-0 h-full min-w-0 overflow-hidden border border-white/10 bg-indigo-950"
          style={{
            left: pct(mediaIndex * mediaWidth),
            width: pct(mediaWidth),
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_25%,rgba(99,102,241,0.45),transparent_46%)]" />
          <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
            {label}
          </div>
        </div>
      ))}
      {usesDialogGridItem && (
        <div
          data-testid="graph-grid-item"
          className="absolute top-0 h-full min-w-0 overflow-hidden border border-purple-400/40 bg-black/85 p-1.5"
          style={{ left: pct(66.6667), width: pct(33.3333) }}
        >
          <GraphPanel items={group.graphItems} />
        </div>
      )}
    </ResponsiveAspectFrame>
  );
}

function DialogPreviewLayoutContract({
  aspectRatio,
  groups,
}: DialogPreviewLayoutContractProps) {
  return (
    <div className="min-h-screen bg-[#050505] p-8 text-white">
      <div
        data-testid="preview-stage"
        data-aspect-ratio={aspectRatio}
        className="grid w-full gap-4"
        style={{
          gridTemplateColumns: groups.length > 1 ? `repeat(${groups.length}, minmax(0, 1fr))` : 'minmax(0, 1fr)',
          height: 'calc(100vh - 4rem)',
        }}
      >
        {groups.map((group, index) => (
          <ContractFrame
            key={group.id}
            aspectRatio={aspectRatio}
            group={group}
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: 'Editor/Preview/Dialog Grid Contract',
  component: DialogPreviewLayoutContract,
  args: {
    aspectRatio: defaultAspectRatio,
  },
  argTypes: {
    aspectRatio: {
      control: 'select',
      options: Object.keys(aspectRatioOptions),
    },
    groups: {
      control: 'object',
    },
  },
} satisfies Meta<typeof DialogPreviewLayoutContract>;

export default meta;

type Story = StoryObj<typeof meta>;

const assertFramesRespectAspectRatio = async (
  canvasElement: HTMLElement,
  aspectRatio: AspectRatioKey = defaultAspectRatio,
) => {
  const canvas = within(canvasElement);
  const expectedRatio = getAspectRatio(aspectRatio).factor;

  await waitFor(() => {
    const cells = canvas.getAllByTestId('group-cell');
    const frames = canvas.getAllByTestId('group-frame');

    frames.forEach((frame, index) => {
      const cellRect = cells[index].getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();

      expect(frameRect.width).toBeGreaterThan(0);
      expect(frameRect.height).toBeGreaterThan(0);
      expect(Math.abs((frameRect.width / frameRect.height) - expectedRatio)).toBeLessThan(0.03);
      expect(Math.abs(frameRect.width - Math.min(cellRect.width, cellRect.height * expectedRatio))).toBeLessThanOrEqual(2);
      expect(Math.abs(frameRect.height - Math.min(cellRect.height, cellRect.width / expectedRatio))).toBeLessThanOrEqual(2);
      expect(frameRect.left).toBeGreaterThanOrEqual(cellRect.left - 1);
      expect(frameRect.right).toBeLessThanOrEqual(cellRect.right + 1);
      expect(frameRect.top).toBeGreaterThanOrEqual(cellRect.top - 1);
      expect(frameRect.bottom).toBeLessThanOrEqual(cellRect.bottom + 1);
    });
  });
};

const assertRightThirdPanel = async (canvasElement: HTMLElement, groups: ContractGroup[]) => {
  const canvas = within(canvasElement);

  await waitFor(() => {
    const frames = canvas.getAllByTestId('group-frame');

    frames.forEach((frame, index) => {
      const graphCell = frame.querySelector<HTMLElement>('[data-testid="graph-grid-item"]');
      const frameRect = frame.getBoundingClientRect();

      if (!groups[index].showDialogGridItem) {
        expect(graphCell).toBeNull();
        return;
      }

      if (!graphCell) throw new Error(`Missing dialog grid item for group ${groups[index].id}`);
      const graphRect = graphCell.getBoundingClientRect();

      expect(Math.abs(graphRect.left - (frameRect.left + frameRect.width * 2 / 3))).toBeLessThanOrEqual(2);
      expect(Math.abs(graphRect.width - frameRect.width / 3)).toBeLessThanOrEqual(2);
      expect(graphRect.right).toBeLessThanOrEqual(frameRect.right + 1);
      expect(Math.abs(graphRect.height - frameRect.height)).toBeLessThanOrEqual(2);

      within(graphCell).getAllByTestId('graph-card').forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        expect(cardRect.left).toBeGreaterThanOrEqual(graphRect.left - 1);
        expect(cardRect.right).toBeLessThanOrEqual(graphRect.right + 1);
        expect(cardRect.top).toBeGreaterThanOrEqual(graphRect.top - 1);
        expect(cardRect.bottom).toBeLessThanOrEqual(graphRect.bottom + 1);
      });
    });
  });
};

const assertStageTracksViewportHeight = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  const viewport = canvasElement.ownerDocument.defaultView;

  await waitFor(() => {
    const stage = canvas.getByTestId('preview-stage');
    const stageRect = stage.getBoundingClientRect();
    const expectedHeight = (viewport?.innerHeight ?? 0) - 64;

    expect(Math.abs(stageRect.height - expectedHeight)).toBeLessThanOrEqual(2);
  });
};

export const GraphOnlyGroupIsNotASeparatePreview: Story = {
  args: {
    groups: [
      {
        id: 'video-with-detached-graphs',
        mediaItems: ['video item'],
        graphItems: ['tension', 'notes', 'suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(1);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};

export const TwoMediaItemsShareTheLeftTwoThirds: Story = {
  args: {
    groups: [
      {
        id: 'two-media-with-graphs',
        mediaItems: ['image a', 'image b'],
        graphItems: ['tension', 'notes', 'suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await waitFor(() => {
      const frameRect = canvas.getAllByTestId('group-frame')[0].getBoundingClientRect();
      const mediaItems = canvas.getAllByTestId('media-grid-item');

      expect(mediaItems).toHaveLength(2);
      mediaItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        expect(Math.abs(rect.width - frameRect.width / 3)).toBeLessThanOrEqual(2);
        expect(rect.right).toBeLessThanOrEqual(frameRect.left + frameRect.width * 2 / 3 + 1);
      });
    });
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};

export const MultipleEnabledVisualGroupsCreateMultiplePreviews: Story = {
  args: {
    groups: [
      {
        id: 'group-one',
        mediaItems: ['group one media'],
        graphItems: ['tension', 'notes'],
        showDialogGridItem: true,
      },
      {
        id: 'group-two',
        mediaItems: ['group two media'],
        graphItems: ['suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(2);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};

export const PerGroupDialogGridItemSetting: Story = {
  args: {
    groups: [
      {
        id: 'dialog-grid-on',
        mediaItems: ['dialog grid on'],
        graphItems: ['tension', 'notes'],
        showDialogGridItem: true,
      },
      {
        id: 'dialog-grid-off',
        mediaItems: ['dialog grid off a', 'dialog grid off b'],
        graphItems: ['hidden tension'],
        showDialogGridItem: false,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(2);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);

    await waitFor(() => {
      const frames = canvas.getAllByTestId('group-frame');
      const secondFrameRect = frames[1].getBoundingClientRect();
      const secondFrameMedia = Array.from(frames[1].querySelectorAll<HTMLElement>('[data-testid="media-grid-item"]'));

      expect(secondFrameMedia).toHaveLength(2);
      secondFrameMedia.forEach((item) => {
        const rect = item.getBoundingClientRect();
        expect(Math.abs(rect.width - secondFrameRect.width / 2)).toBeLessThanOrEqual(2);
        expect(rect.right).toBeLessThanOrEqual(secondFrameRect.right + 1);
      });
    });
  },
};

export const ExtraWideMultiplePreviewsRespectAspectRatio: Story = {
  args: {
    aspectRatio: '21:9',
    groups: [
      {
        id: 'extra-wide-group-one',
        mediaItems: ['extra wide one'],
        graphItems: ['tension', 'notes'],
        showDialogGridItem: true,
      },
      {
        id: 'extra-wide-group-two',
        mediaItems: ['extra wide two a', 'extra wide two b'],
        graphItems: ['suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(2);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};

export const ViewportHeightResizeContract: Story = {
  args: {
    aspectRatio: '16:9',
    groups: [
      {
        id: 'viewport-responsive-group',
        mediaItems: ['viewport media a', 'viewport media b'],
        graphItems: ['tension', 'notes', 'suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(1);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};

export const MultiplePreviewsResizeWithViewportHeight: Story = {
  args: {
    aspectRatio: '16:9',
    groups: [
      {
        id: 'viewport-group-one',
        mediaItems: ['viewport group one'],
        graphItems: ['tension', 'notes'],
        showDialogGridItem: true,
      },
      {
        id: 'viewport-group-two',
        mediaItems: ['viewport group two a', 'viewport group two b'],
        graphItems: ['suspense'],
        showDialogGridItem: true,
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getAllByTestId('group-frame')).toHaveLength(2);
    await assertStageTracksViewportHeight(canvasElement);
    await assertFramesRespectAspectRatio(canvasElement, args.aspectRatio);
    await assertRightThirdPanel(canvasElement, args.groups);
  },
};
