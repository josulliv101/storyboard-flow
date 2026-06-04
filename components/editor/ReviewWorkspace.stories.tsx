import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { scheduleReviewMomentExpansions } from './review-note-layout';

type DenseNoteMomentContractProps = {
  simultaneousNotes: string[];
};

const NOTE_HEIGHT = 82;
const NOTE_ROW_GAP = 0;
const COLUMNS = 2;
const ROW_DISTANCE = NOTE_HEIGHT + NOTE_ROW_GAP;
const PX_PER_FRAME = 3;
const MOMENT_FRAME = 40;
const NOTE_READING_INSET = 12;

function DenseNoteMomentContract({ simultaneousNotes }: DenseNoteMomentContractProps) {
  const rowCount = Math.ceil(simultaneousNotes.length / COLUMNS);
  const extraScrollDistance = Math.max(0, rowCount - 1) * ROW_DISTANCE;
  const [expansion] = scheduleReviewMomentExpansions([
    { startFrame: MOMENT_FRAME, scrollStart: MOMENT_FRAME * PX_PER_FRAME, duration: extraScrollDistance },
  ]);
  const scrollTopAtMomentStart = MOMENT_FRAME * PX_PER_FRAME;
  const momentTop = NOTE_READING_INSET + (MOMENT_FRAME * PX_PER_FRAME) - scrollTopAtMomentStart;
  const followingNoteTop = momentTop + (rowCount * ROW_DISTANCE) + 54;

  return (
    <div className="min-h-screen bg-[#080809] p-8 text-zinc-100">
      <div className="mb-6 max-w-2xl">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-300">
          Dense Note Moment
        </div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          At frame 40, the timed note moment appears fully below the top playhead
          marker beneath the preview. Additional notes continue in rows below it.
        </p>
      </div>
      <div
        data-testid="preview-bottom-edge"
        className="flex w-full max-w-2xl items-center justify-between rounded-t border border-zinc-800 bg-zinc-950 px-4 py-2"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300">Preview / Scene One</span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-indigo-300">
          Playhead: {MOMENT_FRAME} fr
        </span>
      </div>
      <div
        data-testid="reading-surface"
        className="relative w-full max-w-2xl overflow-hidden rounded-b border border-t-0 border-zinc-800 bg-zinc-950/80 p-4"
        style={{ height: `${followingNoteTop + NOTE_HEIGHT + 48}px` }}
      >
        <div data-testid="playhead-marker" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-indigo-300/70" aria-hidden="true" />
        <div
          data-testid="dense-note-group"
          aria-hidden="true"
          className="pointer-events-none absolute left-2 right-2 rounded-none border border-zinc-600/40 bg-zinc-500/[0.025]"
          style={{
            height: `${NOTE_HEIGHT + ((rowCount - 1) * ROW_DISTANCE) + 10}px`,
            top: `${momentTop - 5}px`,
          }}
        >
          <span className="absolute bottom-3 left-0 top-3 w-0.5 bg-zinc-500/65" />
        </div>
        {simultaneousNotes.map((note, index) => (
          <article
            key={note}
            data-testid="dense-note"
            data-row={Math.floor(index / COLUMNS)}
            className="absolute rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 shadow-sm"
            style={{
              height: `${NOTE_HEIGHT}px`,
              left: index % COLUMNS === 0 ? '16px' : 'calc(50% + 5px)',
              top: `${momentTop + Math.floor(index / COLUMNS) * ROW_DISTANCE}px`,
              width: 'calc(50% - 21px)',
            }}
          >
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              <span className="font-mono text-indigo-300/80">Scene One</span>
              <span>0:01 / Note {index + 1}</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-zinc-200">{note}</div>
          </article>
        ))}
        <article
          data-testid="following-note"
          data-top={followingNoteTop}
          className="absolute left-4 right-4 rounded-md border border-indigo-400/35 bg-indigo-400/10 px-3 py-2"
          style={{ height: `${NOTE_HEIGHT}px`, top: `${followingNoteTop}px` }}
        >
          <div className="text-[9px] font-black uppercase tracking-widest text-indigo-300">0:03 / Later Note</div>
          <div className="mt-2 text-sm font-semibold text-zinc-200">The timeline continues after the dense moment.</div>
        </article>
      </div>
    </div>
  );
}

const meta = {
  title: 'Editor/Review/Dense Notes Contract',
  component: DenseNoteMomentContract,
} satisfies Meta<typeof DenseNoteMomentContract>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ManyNotesAtOneMomentUseReadableRows: Story = {
  args: {
    simultaneousNotes: [
      'Hold on the reveal.',
      'Tension should rise here.',
      'Keep the close-up longer.',
      'Music should soften.',
      'Clarify the next beat.',
      'Check continuity.',
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => {
      const notes = canvas.getAllByTestId('dense-note');
      const noteGroup = canvas.getByTestId('dense-note-group');
      const previewEdge = canvas.getByTestId('preview-bottom-edge');
      const surface = canvas.getByTestId('reading-surface');
      const playheadMarker = canvas.getByTestId('playhead-marker');
      const followingNote = canvas.getByTestId('following-note');
      const topRow = notes.filter(note => note.getAttribute('data-row') === '0');
      const noteBottom = Math.max(...notes.map(note => note.getBoundingClientRect().bottom));
      const groupBounds = noteGroup.getBoundingClientRect();

      expect(notes).toHaveLength(6);
      expect(Math.abs(surface.getBoundingClientRect().top - previewEdge.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
      topRow.forEach(note => {
        expect(note.getBoundingClientRect().top - playheadMarker.getBoundingClientRect().top).toBeGreaterThanOrEqual(NOTE_READING_INSET - 1);
        expect(note.getBoundingClientRect().top).toBeGreaterThan(playheadMarker.getBoundingClientRect().bottom);
      });
      notes.forEach(note => {
        const bounds = note.getBoundingClientRect();
        expect(bounds.top).toBeGreaterThan(groupBounds.top);
        expect(bounds.bottom).toBeLessThan(groupBounds.bottom);
      });
      expect(followingNote.getBoundingClientRect().top).toBeGreaterThanOrEqual(noteBottom + NOTE_ROW_GAP - 1);
      expect(followingNote.getAttribute('data-top')).toBe(String(NOTE_READING_INSET + (3 * ROW_DISTANCE) + 54));
    });
  },
};
