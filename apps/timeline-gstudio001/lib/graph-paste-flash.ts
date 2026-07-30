import type { NodeId } from "@storyboard/ui/dnd-collections";

// A transient accent outline on cards that just arrived from a paste.
//
// Paste at the end of a long grid is otherwise SILENT: the user clicks, the
// cards land below the fold or among thirty identical-looking siblings, and
// nothing on screen distinguishes "it worked" from "the button did nothing".
// Scrolling them into view answers where; this answers which.
//
// A module singleton, like `graphClipboard`, and for a duller reason than that
// one: the cards are not mounted yet at the moment paste returns. Virtualized
// rows mount on their own schedule and the grid re-creates card elements when a
// move re-parents them, so writing a class onto DOM nodes here would miss most
// of them. Publishing the IDS instead lets each card ask on mount, whenever
// that turns out to be.

/** How long the outline holds before fading. Long enough to find the cards
 *  after a scroll, short enough not to become part of the card's look. */
export const PASTE_FLASH_MS = 1500;

export type GraphPasteFlash = Readonly<{
  /** Per-node, so a card subscribes to its OWN state and an unrelated paste
   *  elsewhere on the board does not re-render it. */
  isFlashing: (id: NodeId) => boolean;
  /** Start the outline on these nodes, replacing any previous run. */
  flash: (ids: Iterable<NodeId>) => void;
  subscribe: (listener: () => void) => () => void;
}>;

const NONE: ReadonlySet<NodeId> = new Set();

function createGraphPasteFlash(): GraphPasteFlash {
  let flashing: ReadonlySet<NodeId> = NONE;
  let timer = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    isFlashing: (id) => flashing.has(id),
    flash: (ids) => {
      const next = new Set(ids);
      if (timer) window.clearTimeout(timer);
      flashing = next;
      emit();
      if (next.size === 0) return;
      timer = window.setTimeout(() => {
        timer = 0;
        // Guarded: a SECOND paste during the first one's hold replaces the set
        // and arms a new timer, and this stale one must not clear the new
        // run's highlight early.
        if (flashing !== next) return;
        flashing = NONE;
        emit();
      }, PASTE_FLASH_MS);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const graphPasteFlash = createGraphPasteFlash();
