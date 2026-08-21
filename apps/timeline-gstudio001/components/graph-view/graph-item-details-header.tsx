"use client";

import { Redo2, Undo2, X } from "lucide-react";

import { useScopedHistory } from "./graph-item-details-history";

/**
 * The details view's own header — one, above the whole carousel.
 *
 * WHY IT IS HERE AND NOT ON THE CARDS. Undo, redo and close used to sit on
 * every panel, which meant three close buttons on screen closing the same
 * dialog and three history pairs of which only one was ever the one you
 * wanted. They are properties of the VIEW, so there is one of each, at the
 * top, where a dialog's controls are.
 *
 * The title names the clip in the middle, because that is the clip this view
 * is about; the line under it says where that clip lives and how far along it
 * is. `clip 5 of 13` is the one piece of orientation the carousel cannot give
 * you by looking — the row is cropped, so counting the cards tells you
 * nothing.
 */
export function ItemDetailsHeader({
  title,
  collectionName,
  index,
  total,
  centreId,
  onClose,
}: Readonly<{
  title: string;
  /** The collection the row is walking, for the subtitle. */
  collectionName: string | null;
  /** The subject's position in playback order, 1-based for display. */
  index: number;
  total: number;
  /** Whose history the pair steps through — see below. */
  centreId: string;
  onClose: () => void;
}>) {
  // SCOPED TO THE CENTRE CLIP, which is what makes one pair correct where
  // three were not. `useScopedHistory` already refuses anything that is not a
  // change to the node it names, so this steps back through the edits made to
  // the clip you are looking at and greys out at the edge of them — the same
  // contract each panel had, now attached to the one clip the view is about.
  const history = useScopedHistory(centreId);

  return (
    <div className="pointer-events-auto flex items-start justify-between gap-4 px-6 pt-5">
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold text-zinc-100" title={title}>
          {title}
        </h2>
        <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
          {collectionName === null ? null : `${collectionName} · `}
          {index > 0 && total > 0 ? `clip ${index} of ${total}` : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          data-item-details-undo
          disabled={!history.undoableHere}
          onClick={history.undo}
          aria-label="Undo the last change"
          title="Undo the last change to this item"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-item-details-redo
          disabled={!history.redoableHere}
          onClick={history.redo}
          aria-label="Redo the last change"
          title="Redo the last change to this item"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
        >
          <Redo2 aria-hidden="true" className="h-4 w-4" />
        </button>
        {/* A rule between the edits and the exit: undo and redo change the
            clip, close changes nothing, and grouping them without a divider
            invites the wrong one. */}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/15" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the details view"
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
