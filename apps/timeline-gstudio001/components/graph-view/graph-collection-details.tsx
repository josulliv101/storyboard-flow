"use client";

import { useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { Redo2, Undo2, X } from "lucide-react";

import {
  isEditableKeyboardTarget,
  type CollectionItemNode,
} from "@storyboard/ui/dnd-collections";

import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { formatDuration } from "@/lib/format-duration";
import { collectionPreviewFrameUrl } from "@/lib/video-frame-url";

import { useClipDetail, useTimelineTitle } from "./graph-details-context";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import {
  useCollectionPreviewFrames,
  useEnabledChildCount,
  useHydratedCollectionSeconds,
} from "./graph-item-content";
import { GraphViewNavContext } from "./graph-navigation";
import { DETAILS_HERO_FILL_CLASS, DETAILS_PANEL_HEIGHT_CLASS } from "./graph-view-config";

// A COLLECTION's details (PL11-012).
//
// Drilling in already answers "what is in here", so this deliberately is not a
// second timeline view. It answers what you would otherwise have to drill in
// and come back out to learn — how much is inside, how long it runs, whether
// it is even loaded — and lets the name be fixed on the spot.
//
// The hero is its contents, because a timeline's identity is its footage: the
// card morphs into a larger version of the frames it was already showing.

export function CollectionDetailsBody({
  node,
  hero,
  history,
  onClose,
}: Readonly<{
  node: CollectionItemNode;
  /** The shared view-transition name the card hands over. */
  hero: string;
  history: Readonly<{
    undoableHere: boolean;
    redoableHere: boolean;
    undo: () => void;
    redo: () => void;
  }>;
  onClose: () => void;
}>) {
  const nav = useContext(GraphViewNavContext);
  // The gateway is the source of truth for a collection's title (the card and
  // the breadcrumb read it too), so a rename made anywhere shows up here.
  const title = useTimelineTitle(node.id as string);
  const displayName = title ?? node.name;
  const rename = useInlineRename(node.id, displayName, "item-details");

  const detail = useClipDetail(node.id as string);
  const hydrated = detail?.hydrated === true;
  const liveCount = useEnabledChildCount(node.id);
  const liveSeconds = useHydratedCollectionSeconds(node.id as string, hydrated);
  // Live numbers once loaded; the stored summary for a placeholder — the same
  // rule the card follows, so the two never disagree.
  const count = hydrated ? liveCount : (detail?.itemCount ?? liveCount);
  const seconds =
    (hydrated ? liveSeconds : (detail?.playableDuration ?? detail?.duration)) ?? 0;
  const previews = useCollectionPreviewFrames(node.id as string, hydrated, detail?.previewItems);

  const { dialogProps } = useDialogFocus<HTMLDivElement>();

  const beginRename = rename.begin;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Capture phase, so the editable guard is what keeps Escape from
      // closing the whole view mid-rename.
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        beginRename();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, beginRename]);

  return createPortal(
    <div
      data-item-details={node.id}
      data-item-details-kind="collection"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${displayName}`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* This dialog was left out when the clip modal gained focus management,
          so it still declared `aria-modal="true"` while doing none of what
          that promises — focus stayed behind the scrim and Tab walked out into
          a board the reader had been told was hidden. Same hook, same three
          behaviours: move in, trap, restore. */}
      <div
        {...dialogProps}
        className={`flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl shadow-black/60 focus-visible:outline-none ${DETAILS_PANEL_HEIGHT_CLASS}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          {rename.editing ? (
            <InlineNameEditor
              initialValue={displayName}
              onInput={rename.setDraft}
              onCommit={rename.commit}
              onCancel={rename.cancel}
              ariaLabel="Timeline name"
              className="min-w-0 flex-1 rounded-sm bg-zinc-900 px-1 py-0.5 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-amber-400/70"
            />
          ) : (
            <span
              onDoubleClick={rename.begin}
              title="Double-click or press F2 to rename"
              className="min-w-0 flex-1 cursor-text truncate text-sm font-semibold text-zinc-100"
            >
              {displayName}
            </span>
          )}
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
              {count} {count === 1 ? "item" : "items"} · {formatDuration(seconds)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-item-details-undo
                disabled={!history.undoableHere}
                onClick={history.undo}
                aria-label="Undo the last change"
                title="Undo the last change to this timeline"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Undo2 aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-item-details-redo
                disabled={!history.redoableHere}
                onClick={history.redo}
                aria-label="Redo the last change"
                title="Redo the last change to this timeline"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Redo2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the details view"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Fills whatever the fixed panel leaves, exactly as the clip modal's
            hero does — see DETAILS_HERO_FILL_CLASS. This body carries less
            chrome than the clip's, so its hero simply ends up larger; the
            dialog itself is the same box either way. */}
        <div
          data-item-details-frame
          style={{ viewTransitionName: hero }}
          className={`flex ${DETAILS_HERO_FILL_CLASS} gap-1 overflow-hidden rounded-md border border-dashed border-sky-500/40 bg-sky-500/[0.06] p-2`}
        >
          {previews.length === 0 ? (
            <span className="flex w-full items-center justify-center font-mono text-[11px] text-zinc-500">
              {hydrated ? "This timeline is empty." : "Not loaded yet — open it to see inside."}
            </span>
          ) : (
            previews.map((preview, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // Keyed by SLOT, not content: the frames are a fixed-length,
                // order-stable pair, and keying by id both collides and
                // remounts on every child edit (the card learned this).
                key={index}
                src={collectionPreviewFrameUrl(preview)}
                alt=""
                draggable={false}
                // `object-contain`, not `cover`, now that the frame is tall:
                // cover would crop a 16:9 still to a near-square column and
                // throw away most of the shot. Contain letterboxes instead —
                // the same choice the clip modal's hero makes, and the reason
                // a fixed height is safe for both.
                className="h-full min-w-0 flex-1 rounded-sm object-contain"
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
          <span className="text-sky-200/90">
            {hydrated ? "loaded" : "summary only"}
          </span>
          <button
            type="button"
            data-item-details-open
            onClick={() => {
              onClose();
              nav?.openTimeline(node.id);
            }}
            className="rounded px-2 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/10 hover:text-sky-100"
          >
            Open this timeline
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
