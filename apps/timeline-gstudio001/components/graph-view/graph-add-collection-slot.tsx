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
      // COMPACT. This used to be a full-bleed dashed panel with two labelled
      // buttons and a hint line — a whole card's worth of chrome parked at the
      // end of every strip and grid, permanently, to offer something you reach
      // for occasionally. It is now a small icon pair, centred in whatever box
      // the surface reserves.
      //
      // The BOX is still card-sized: the surface sets it (`width: itemWidth`
      // in VirtualStrip, `fillCellWidth` in VirtualGrid) and this component
      // only fills it. Shrinking the reservation itself is a package change,
      // not one available here.
      className="flex h-full w-full items-center justify-center gap-1.5 text-zinc-500"
    >
      <button
        type="button"
        data-add-collection-button={collectionId}
        aria-label="Add a timeline to the end"
        title="Add a timeline here"
        onClick={() => append(childCount)}
        // Reads as a BUTTON that adds, not as an empty slot: a solid tile with
        // a dashed edge (the dashes are what still say "nothing here yet"),
        // and a hover that fills rather than just tinting text. The glyph is
        // the same FolderPlus the controls row uses, so the two routes to the
        // same action look like the same action.
        className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 transition-colors hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
      >
        <FolderPlus aria-hidden="true" className="h-4 w-4" />
      </button>

      {/* The media half. Only offered where files can actually land — outside a
          native-drop surface there is no timeline to append to, and a button
          that cannot work is worse than none.

          KEPT, though the label and the hint line are gone. This button is the
          ONLY keyboard route to adding media (PL14-011): dragging from the OS
          starts outside the page and has no keyboard equivalent, so dropping
          it would leave keyboard and switch users with no way to add media at
          all. Icon-only costs nothing here — it always had an `aria-label` and
          a `title` doing the real explaining. */}
      {appendFiles !== null ? (
        <>
          <button
            type="button"
            data-add-media-button={collectionId}
            aria-label="Add media files to the end of this timeline"
            title="Browse for images and videos — or drop them anywhere on the timeline"
            onClick={() => fileInputRef.current?.click()}
            className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 transition-colors hover:border-sky-500/60 hover:bg-sky-500/10 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
          >
            <ImageIcon aria-hidden="true" className="h-4 w-4" />
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
