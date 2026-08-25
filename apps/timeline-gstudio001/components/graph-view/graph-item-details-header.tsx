"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { useScopedHistory } from "./graph-item-details-history";

/**
 * How long the notice stays up.
 *
 * Long enough to read a sentence with two numbers in it without hurrying, and
 * short enough that it is gone before the next edit — a notice still on screen
 * describing the edit before last is worse than none, because it is read as
 * describing the one just made.
 */
const NOTE_MS = 4000;

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
  const history = useScopedHistory(centreId, index > 0 ? `clip ${index}` : null);

  // UP UNTIL THE TIMER, OR UNTIL THE NEXT ONE. Keyed on `noteKey` rather than
  // on the note's own text so two identical undos in a row restart the clock
  // instead of letting the first one's timer dismiss the second.
  const [shownKey, setShownKey] = useState(0);
  const note = history.noteKey === shownKey ? null : history.note;
  useEffect(() => {
    if (history.noteKey === shownKey) return;
    const timer = setTimeout(() => setShownKey(history.noteKey), NOTE_MS);
    return () => clearTimeout(timer);
  }, [history.noteKey, shownKey]);

  return (
    <div
      data-item-details-header
      className="pointer-events-auto flex items-start justify-between gap-4 px-6 pt-5"
    >
      {/* ONE LINE, AND WHERE YOU ARE COMES FIRST.
          It was two lines with the name on top. But the name is already the
          largest thing on the centre panel a few hundred pixels below, so
          spending the header's strongest position on it said the same thing
          twice — while the fact the cropped row genuinely cannot give you,
          which collection this is and how far into it you are, sat underneath
          in grey. Swapping them puts the orientation first and lets the name
          trail it as confirmation. */}
      <div className="flex min-w-0 items-baseline gap-2">
        <h2
          className="shrink-0 truncate font-mono text-[15px] font-bold tracking-tight text-zinc-100"
          title={title}
        >
          {collectionName === null ? title : collectionName}
          {index > 0 && total > 0 ? (
            <span className="text-zinc-100"> · clip {index} of {total}</span>
          ) : null}
        </h2>
        {collectionName === null ? null : (
          <p className="truncate font-mono text-[13px] text-zinc-500" title={title}>
            {title}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* WHAT THAT PRESS DID, beside the button that did it.
            A left rule rather than a filled pill: the notice appears and goes
            without being asked for, so it has to be findable without being
            loud — a solid amber block next to a row of grey icons would pull
            the eye off the picture every time anyone pressed undo. Amber
            because it is the one colour in this view that means neither
            "playing" (red) nor "now" (blue). */}
        {note === null ? null : (
          <div
            data-item-details-note
            role="status"
            aria-live="polite"
            className={[
              "flex max-w-md items-center gap-2 rounded-r-md border-l-2 border-amber-400/90",
              "bg-amber-400/10 py-1 pr-3 pl-2 font-mono text-[11px] whitespace-nowrap",
              "animate-seam-note-in",
            ].join(" ")}
          >
            <span className="font-semibold text-amber-200">{note.action}</span>
            <span className="text-amber-200/60">·</span>
            <span className="text-amber-100/90">{note.subject}</span>
            {note.detail === "" ? null : (
              <span className="truncate text-amber-200/50">{note.detail}</span>
            )}
          </div>
        )}
        {/* The controls keep their own tighter rhythm; the notice sits apart
            from them so it reads as a report rather than another button. */}
        <div className="flex shrink-0 items-center gap-1">
        {/* UNDO AND REDO ARE NOT HERE ANY MORE (PL15-030). The board's own
            pair sits at the right of the breadcrumb row, one row above this
            one, and two pairs a few pixels apart is the same fault this
            header was created to fix — it took three history pairs off the
            cards precisely because only one of them was ever the one you
            wanted. The divider went with them: with nothing to separate
            close from, a rule beside it is a rule about nothing. */}
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
    </div>
  );
}
