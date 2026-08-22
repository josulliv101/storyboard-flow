"use client";

import { createContext, useContext } from "react";

/**
 * Whether the play bar draws each clip's FIRST FRAME instead of a grey box.
 *
 * OFF BY DEFAULT, and the default is the argument for it being a setting.
 * A bar of thumbnails answers "which shot is that" without a hover, which is
 * the whole reason to want it. What it costs is the thing the grey bar is
 * good at: box widths are durations, and a run of even grey reads as rhythm —
 * where the cuts fall, which shots are long, where the pace changes. Put
 * pictures in them and the eye reads the pictures, because it always will.
 *
 * IT IS ALSO NOT FREE. A box's width is its duration, so at a wide reach the
 * short clips are a few pixels across and their frames are unreadable smears
 * — the same picture that helps at ten clips is noise at a hundred. Leaving
 * this off by default means the expensive answer is the one you ask for.
 *
 * A CONTEXT, NOT A PROP, for the reason `ClipNamesProvider` gives: the
 * consumer is several layers down inside a portalled dialog, the value is
 * constant across the board, and it changes only when someone opens a menu.
 *
 * DEFAULTS TO FALSE WITH NO PROVIDER, so a bar rendered outside the board —
 * a story, most of all — behaves like the shipped default rather than
 * throwing or silently opting in.
 */
const PlaybarThumbnailsContext = createContext(false);

export function PlaybarThumbnailsProvider({
  shown,
  children,
}: Readonly<{ shown: boolean; children: React.ReactNode }>) {
  return (
    <PlaybarThumbnailsContext.Provider value={shown}>
      {children}
    </PlaybarThumbnailsContext.Provider>
  );
}

/** Whether the play bar should draw frames rather than grey boxes. */
export function usePlaybarThumbnails(): boolean {
  return useContext(PlaybarThumbnailsContext);
}
