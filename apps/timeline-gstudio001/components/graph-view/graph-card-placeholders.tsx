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
 * Paper, not black — the same call `CollectionLeaderPlaceholder` makes: an
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
 * What an EMPTY collection shows: an academy-leader countdown frame.
 *
 * The slot used to be blank — a dark rectangle that read as a broken thumbnail
 * rather than as "nothing in here yet". A leader frame is the film industry's
 * own mark for "before the picture starts", which is exactly the state, and it
 * gives the card a recognizable silhouette at strip size where any label would
 * be too small to read.
 *
 * Drawn rather than loaded. At card size the geometry is the whole message —
 * the ring, the crosshair, the sweep — and the reference photograph's grain and
 * scratches are invisible; a vector costs no request, stays crisp in the grid's
 * much larger cells, and takes the board's own palette instead of fighting it
 * with a bright sepia field. (If the scanned frame itself is wanted, this is the
 * one place to swap it.)
 */
export function CollectionLeaderPlaceholder() {
  return (
    <svg
      viewBox="0 0 160 90"
      aria-hidden="true"
      className="h-full w-full text-zinc-500/70"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Paper, not black: an empty card reads as a FRAME rather than a hole. */}
      <rect width="160" height="90" className="fill-zinc-800/40" />
      {/* The sweep — the sector a leader's rotating hand has already passed. */}
      <path d="M80 45 L80 6 A39 39 0 0 1 114 26 Z" className="fill-zinc-700/45" />
      <g stroke="currentColor" fill="none" strokeWidth="1.5">
        {/* Crosshair, edge to edge. */}
        <path d="M80 0 V90 M0 45 H160" strokeWidth="1" />
        {/* The ring: two concentric strokes, the leader's signature. */}
        <circle cx="80" cy="45" r="39" />
        <circle cx="80" cy="45" r="33" />
      </g>
    </svg>
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
