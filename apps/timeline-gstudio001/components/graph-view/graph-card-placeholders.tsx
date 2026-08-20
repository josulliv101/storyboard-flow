"use client";

import { CornerRightDown, Music } from "lucide-react";

/**
 * What a card shows when it has no picture — one module, because the three
 * cases are one decision made three ways and both card kinds reach for them.
 */

/**
 * An audio card's stand-in: a music glyph on paper.
 *
 * A SYMBOL, not a drawn waveform. The drawn waveform this replaces was a fixed
 * pseudo-random bar set — it looked like data while being decoration, and the
 * peaks it implied belonged to no particular file, so two different takes drew
 * the identical "waveform". A glyph makes no such claim: it says "this is
 * sound" and stops.
 *
 * Real peaks are still not an option here, for the reason the drawn version
 * gave: decoding requires fetching whole files and a board holds dozens of
 * cards. Actual peaks belong to the waveform LANE, which is cached, capped at
 * three concurrent decodes and limited to visible cards.
 *
 * Paper, not black — an
 * audio card is a FRAME with no picture, not a hole where one failed to load.
 */
export function AudioPlaceholder() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-zinc-800/40">
      <Music
        aria-hidden="true"
        strokeWidth={1.5}
        // Sized off the CARD's height rather than fixed, so one glyph serves a
        // tall grid cell and a short strip clip alike; clamped at both ends so
        // it can neither fill a large cell nor shrink to a speck. Height-based
        // because a strip clip's WIDTH is its duration — keying off that would
        // swell the note on a long clip and crush it on a short one.
        className="h-1/2 max-h-10 min-h-3 w-auto text-zinc-400/70"
      />
    </span>
  );
}

/**
 * What an EMPTY collection shows: a dark gradient, and nothing else.
 *
 * This slot has now been three things, and the third is deliberate. It began
 * BLANK — a flat dark rectangle that read as a broken thumbnail rather than as
 * "nothing in here yet". It then drew an academy-leader countdown frame: the
 * film industry's own mark for "before the picture starts", which is exactly
 * the state, with a silhouette legible at strip size.
 *
 * The leader is gone because it was answering a question that is now answered
 * better elsewhere. It had to say BOTH "this is empty" and "this is a
 * collection", and it said the second one in a private vocabulary — a ring and
 * a crosshair mean "collection" to nobody who has not been told. The card now
 * wears the same `Layers` mark on its centre that every OTHER collection card
 * wears (see `data-collection-mark`), so identity is said once, consistently,
 * and this layer only has to say "empty".
 *
 * A GRADIENT rather than the original flat fill, because that distinction is
 * the whole reason the leader was drawn in the first place: a flat dark
 * rectangle looks like an image that failed to load, while a graded one reads
 * as a surface somebody chose. It is dark enough that the mark's translucent
 * disc still reads on top of it.
 */
export function EmptyCollectionPlaceholder() {
  return (
    <span
      aria-hidden="true"
      // zinc-800 → zinc-950 on a diagonal. Arbitrary-value gradients are used
      // elsewhere in this app (the preview surface's mask), so this stays in
      // Tailwind rather than reaching for an inline style.
      className="h-full w-full bg-[linear-gradient(155deg,#27272a_0%,#18181b_55%,#09090b_100%)]"
    />
  );
}

/**
 * The mark on the DRAG GHOST of a collection that has no frames to show.
 *
 * CornerRightDown — turn and descend. It was named `CollectionDrillGlyph` while
 * it was the drill control's glyph, and that control is gone; this is the one
 * place it survived, where the job is to say "the thing you are dragging is a
 * collection", not "go into this". Kept rather than swapped for the caption's
 * Layers: at 28px on a translucent ghost the heavier arrow reads, and the two
 * marks are never on screen together.
 *
 * NOT a folder, despite what this was called until PL13-004 — the sidebar's
 * FolderTree toggles whether the children tree is SHOWN, a different verb that
 * deliberately does not share an icon with anything here.
 */
export function CollectionGhostGlyph({ className }: Readonly<{ className?: string }>) {
  return <CornerRightDown aria-hidden="true" className={className} strokeWidth={1.5} />;
}
