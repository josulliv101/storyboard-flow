import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { CompactNotesTagOverlay, type PreviewGraphNote } from './Preview';

const densePreviewNote: PreviewGraphNote = {
  id: 'dense-preview-note',
  note: 'Multiple review tags should remain visible.',
  frame: 30,
  tags: ['composition', 'lighting', 'continuity', 'wardrobe'],
  displayTags: ['composition', 'lighting', 'continuity', 'wardrobe'],
  metricTags: [],
};

const graphLayerTags = [
  { id: 'tension', label: 'Tension', color: '#ef4444', value: 2.1, isGraph: true as const },
  { id: 'suspense', label: 'Suspense', color: '#38bdf8', value: 4.2, isGraph: true as const },
];

const addedPreviewNote: PreviewGraphNote = {
  id: 'added-preview-note',
  note: 'A new visible note contributes another tag.',
  frame: 30,
  tags: ['blocking'],
  displayTags: ['blocking'],
  metricTags: [],
};

const sparsePreviewNote: PreviewGraphNote = {
  id: 'sparse-preview-note',
  note: 'Sparse tags should keep their grid columns.',
  frame: 30,
  tags: ['composition'],
  displayTags: ['composition'],
  metricTags: [],
};

const duplicatePreviewNote: PreviewGraphNote = {
  id: 'duplicate-preview-note',
  note: 'Duplicate labels render once in the compact overlay.',
  frame: 30,
  tags: ['Tension', 'composition', 'Composition'],
  displayTags: ['Tension', 'composition', 'Composition'],
  metricTags: [],
};

function PreviewTagGridContract() {
  const [showAddedNote, setShowAddedNote] = React.useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-white">
      <button
        type="button"
        className="mb-4 rounded border border-zinc-700 px-3 py-2 text-xs"
        onClick={() => setShowAddedNote(true)}
      >
        Add visible note
      </button>
      <div
        data-testid="preview-tag-surface"
        className="relative w-[484px] overflow-hidden rounded border border-zinc-800 bg-zinc-900 p-3"
      >
        <CompactNotesTagOverlay
          items={showAddedNote ? [densePreviewNote, addedPreviewNote] : [densePreviewNote]}
          leadingGraphTags={graphLayerTags}
        />
      </div>
    </div>
  );
}

function SparsePreviewTagGridContract() {
  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-white">
      <div
        data-testid="preview-tag-surface"
        className="relative w-[484px] overflow-hidden rounded border border-zinc-800 bg-zinc-900 p-3"
      >
        <CompactNotesTagOverlay items={[sparsePreviewNote]} leadingGraphTags={[graphLayerTags[0]]} />
      </div>
    </div>
  );
}

function DedupedPreviewTagGridContract() {
  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-white">
      <div
        data-testid="preview-tag-surface"
        className="relative w-[484px] overflow-hidden rounded border border-zinc-800 bg-zinc-900 p-3"
      >
        <CompactNotesTagOverlay
          items={[duplicatePreviewNote, sparsePreviewNote]}
          leadingGraphTags={[graphLayerTags[0]]}
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'Editor/Preview/Tag Grid Contract',
  component: PreviewTagGridContract,
} satisfies Meta<typeof PreviewTagGridContract>;

export default meta;

type Story = StoryObj<typeof meta>;

export const DenseNoteAndGraphTagsWrapToAdditionalRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      const surface = canvas.getByTestId('preview-tag-surface');
      const tags = canvas.getAllByTestId('compact-preview-tag');
      const surfaceBounds = surface.getBoundingClientRect();
      const rowTops = Array.from(new Set(tags.map(tag => Math.round(tag.getBoundingClientRect().top))));
      const tension = canvas.getByText('Tension');
      const suspense = canvas.getByText('Suspense');
      const composition = canvas.getByText('composition');
      const lighting = canvas.getByText('lighting');

      expect(tags).toHaveLength(6);
      expect(rowTops).toHaveLength(2);
      expect(tension.getBoundingClientRect().top).toBe(suspense.getBoundingClientRect().top);
      expect(tension.getBoundingClientRect().right).toBeGreaterThan(suspense.getBoundingClientRect().right);
      expect(suspense.getBoundingClientRect().right).toBeGreaterThan(composition.getBoundingClientRect().right);
      expect(lighting.getBoundingClientRect().top).toBeGreaterThan(tension.getBoundingClientRect().top);
      expect(lighting.getBoundingClientRect().right).toBeGreaterThan(composition.getBoundingClientRect().right);
      tags.forEach(tag => {
        const bounds = tag.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(surfaceBounds.left);
        expect(bounds.right).toBeLessThanOrEqual(surfaceBounds.right);
      });
    });

    const initialGrid = canvas.getByTestId('compact-preview-tag-grid').getBoundingClientRect();
    await userEvent.click(canvas.getByRole('button', { name: 'Add visible note' }));

    await waitFor(() => {
      const updatedGrid = canvas.getByTestId('compact-preview-tag-grid').getBoundingClientRect();

      expect(canvas.getAllByTestId('compact-preview-tag')).toHaveLength(7);
      expect(canvas.getByText('blocking')).toBeInTheDocument();
      expect(Math.round(updatedGrid.top)).toBe(Math.round(initialGrid.top));
      expect(Math.round(updatedGrid.right)).toBe(Math.round(initialGrid.right));
    });
  },
};

export const SparseTagsPreserveUnpopulatedColumns: Story = {
  render: () => <SparsePreviewTagGridContract />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      const grid = canvas.getByTestId('compact-preview-tag-grid');
      const tags = canvas.getAllByTestId('compact-preview-tag');
      const columns = window
        .getComputedStyle(grid)
        .gridTemplateColumns.split(' ')
        .map(column => Number.parseFloat(column));

      expect(tags).toHaveLength(2);
      expect(columns).toHaveLength(3);
      columns.forEach(column => expect(column).toBeGreaterThan(0));
    });
  },
};

export const DuplicateLabelsRenderOnlyOnce: Story = {
  render: () => <DedupedPreviewTagGridContract />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      expect(canvas.getAllByTestId('compact-preview-tag')).toHaveLength(2);
      expect(canvas.getAllByText('Tension')).toHaveLength(1);
      expect(canvas.getAllByText('composition')).toHaveLength(1);
      expect(canvas.getByText('Tension').closest('[data-testid="compact-preview-tag"]')).toHaveAttribute('data-tag-count', '2');
      expect(canvas.getByText('composition').closest('[data-testid="compact-preview-tag"]')).toHaveAttribute('data-tag-count', '3');
    });
  },
};
