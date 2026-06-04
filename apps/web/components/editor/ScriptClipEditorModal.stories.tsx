import React from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import type { TimelineClip, TimelineTrack } from '@/lib/timeline-context';
import { ScriptClipEditorModal } from './Editor';

const SELECTED_NOTE_INDEX = 18;
const SELECTED_NOTE_BODY = 'Selected note body should receive the caret.';

const notes: TimelineClip[] = Array.from({ length: 24 }, (_, index) => ({
  id: `note-${index}`,
  name: index === SELECTED_NOTE_INDEX ? 'Selected Note' : `Note ${index + 1}`,
  description: index === SELECTED_NOTE_INDEX
    ? SELECTED_NOTE_BODY
    : `Editorial note content for moment ${index + 1}.`,
  type: 'note',
  startFrame: index * 30,
  duration: 30,
  trackId: 'notes-track',
  color: 'bg-amber-600',
}));

const tracks: TimelineTrack[] = [
  { id: 'notes-track', name: 'Notes', parentId: 'scene-track' },
];

function ScriptEditorOpenContract() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-zinc-100">
      <button
        type="button"
        className="rounded border border-zinc-700 px-4 py-2"
        onClick={() => setOpen(true)}
      >
        Edit selected note
      </button>
      {open && (
        <ScriptClipEditorModal
          selectedClip={notes[SELECTED_NOTE_INDEX]}
          clips={notes}
          tracks={tracks}
          characters={[]}
          fps={30}
          updateClip={() => undefined}
          addClip={() => undefined}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const meta = {
  title: 'Editor/Script Editor/Selected Note Focus Contract',
  component: ScriptEditorOpenContract,
} satisfies Meta<typeof ScriptEditorOpenContract>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OffscreenSelectedNoteIsFocusedAndRevealed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Edit selected note' }));

    await waitFor(() => {
      const textarea = canvas.getByRole('textbox', { name: 'Notes script editor' }) as HTMLTextAreaElement;
      const expectedCaretPosition = textarea.value.indexOf(SELECTED_NOTE_BODY);
      const selectedHighlight = canvas.getByTestId(`script-block-highlight-${SELECTED_NOTE_INDEX}`);

      expect(textarea).toHaveFocus();
      expect(expectedCaretPosition).toBeGreaterThan(0);
      expect(textarea.selectionStart).toBe(expectedCaretPosition);
      expect(textarea.selectionEnd).toBe(expectedCaretPosition);
      expect(textarea.scrollTop).toBeGreaterThan(0);
      expect(selectedHighlight).toHaveAttribute('data-active', 'true');
    });

    const textarea = canvas.getByRole('textbox', { name: 'Notes script editor' }) as HTMLTextAreaElement;
    await userEvent.click(textarea);
    await userEvent.keyboard('{Control>}{Home}{/Control}');

    await waitFor(() => {
      expect(canvas.getByTestId('script-block-highlight-0')).toHaveAttribute('data-active', 'true');
      expect(canvas.getByTestId(`script-block-highlight-${SELECTED_NOTE_INDEX}`)).toHaveAttribute('data-active', 'false');
      expect(textarea.scrollTop).toBe(0);
    });

    const firstBodyEnd = textarea.value.indexOf('Editorial note content for moment 1.')
      + 'Editorial note content for moment 1.'.length;
    textarea.setSelectionRange(firstBodyEnd, firstBodyEnd);
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await userEvent.keyboard(' ');

    await waitFor(() => {
      expect(textarea.value).toContain('Editorial note content for moment 1. ');
      expect(canvas.getByTestId('script-block-highlight-0')).toHaveAttribute('data-active', 'true');
      expect(canvas.getByTestId('script-block-highlight-1')).toHaveAttribute('data-active', 'false');
    });
  },
};
