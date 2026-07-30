"use client";

import { useRef } from "react";
import { FolderPlus, Image as ImageIcon } from "lucide-react";

import { getChildren, parseNodeId, useCollectionsSelector } from "@storyboard/ui/dnd-collections";

import { useAppendCollection, useAppendFiles } from "./graph-native-drop";

/**
 * The trailing "add something here" slot, at the end of a strip or grid.
 *
 * Two ways in, because there are two things you can add. Adding a nested
 * timeline used to mean reaching for the sidebar's collection tool, which
 * lands next to the SELECTION — fine when you are working on a card, wrong
 * when what you want is "one more, at the end of this timeline". Adding MEDIA
 * had no keyboard route at all (PL14-011): the only way in was dragging from
 * the OS, a gesture that starts outside the page and has no keyboard
 * equivalent, so a keyboard or switch user could not add media to this app.
 * The browse button is that route, and the browser's own picker is accessible
 * for free.
 *
 * Deliberately not a card: dashed, muted, and no drag, selection or trim
 * behaviour. The surfaces render it past their own content extent, so it is
 * not an item to any of the index math either (see `trailingSlot`).
 *
 * A CONTAINER of controls rather than one button. It was a single `<button>`,
 * which is exactly what a second control could not live inside — nested
 * interactive elements are invalid, and this codebase has been bitten by that
 * before (round 6 had to use `contentEditable` rather than an `<input>`
 * because card content renders inside a button).
 */
export function AddCollectionSlot({
  collectionId,
}: Readonly<{ collectionId: string }>) {
  const append = useAppendCollection(collectionId);
  const appendFiles = useAppendFiles();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Append means "after the last child", and the count is the index. Read
  // live so a drop or an undo elsewhere cannot leave this pointing at a
  // stale position.
  const childCount = useCollectionsSelector(
    (snapshot) => getChildren(snapshot.graph, parseNodeId(collectionId)).length,
  );

  return (
    <div
      data-add-collection-slot={collectionId}
      className="flex h-full w-full flex-col items-stretch justify-center gap-1 rounded-md border border-dashed border-zinc-700 bg-zinc-900/30 p-1.5 text-zinc-500"
    >
      <button
        type="button"
        data-add-collection-button={collectionId}
        aria-label="Add a timeline to the end"
        title="Add a timeline here"
        onClick={() => append(childCount)}
        className="flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded transition-colors hover:bg-sky-500/[0.06] hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
      >
        <FolderPlus aria-hidden="true" className="h-4 w-4" />
        <span className="text-[11px] font-medium leading-none">Add timeline</span>
      </button>

      {/* The media half. Only offered where files can actually land — outside a
          native-drop surface there is no timeline to append to, and a button
          that cannot work is worse than none. */}
      {appendFiles !== null ? (
        <>
          {/* The hint names the gesture that has no control: dragging from the
              file system works anywhere on the timeline, not just here, and
              nothing else on screen says so. `truncate` because a 100px strip
              slot has no room to wrap — the full sentence stays in the
              button's title. */}
          <p className="truncate text-center text-[9px] leading-tight text-zinc-600">
            or drop media anywhere
          </p>
          <button
            type="button"
            data-add-media-button={collectionId}
            aria-label="Add media files to the end of this timeline"
            title="Browse for images and videos — or drop them anywhere on the timeline"
            onClick={() => fileInputRef.current?.click()}
            className="flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors hover:bg-sky-500/[0.06] hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
          >
            <ImageIcon aria-hidden="true" className="h-3 w-3" />
            Browse
          </button>
          {/* The input itself is never shown: it is the picker, not the
              affordance. `sr-only` rather than `display:none` so it stays a
              real form control the button can open. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            tabIndex={-1}
            aria-hidden="true"
            data-add-media-input={collectionId}
            className="sr-only"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Reset BEFORE handing off, so choosing the same file twice in a
              // row fires `change` again — the input compares against its own
              // value, and an unchanged one is silently inert.
              event.target.value = "";
              appendFiles(files);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
