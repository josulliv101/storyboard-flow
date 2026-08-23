"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * How the play bar draws a clip: as nothing, as one frame, or as a strip.
 *
 * `cover` is ONE frame filling the box — the clip's opening image, stretched
 * to whatever shape its duration makes the box. It answers "which shot is
 * that" and nothing else.
 *
 * `filmstrip` is a row of square cells sampled at even intervals across the
 * clip. It answers a second question the single frame cannot: what HAPPENS in
 * the shot. A long take that opens on a closed door and ends on an empty room
 * is one picture at `cover` and a story at `filmstrip`.
 *
 * The cost runs the other way. A strip is several images per box instead of
 * one, and at a wide reach — where boxes are a few pixels across — it is
 * several images per box that nobody can see. Which is the argument for it
 * being a choice rather than an upgrade.
 */
export const PLAYBAR_THUMBNAIL_STYLES = ["cover", "filmstrip"] as const;
export type PlaybarThumbnailStyle = (typeof PLAYBAR_THUMBNAIL_STYLES)[number];

export function isPlaybarThumbnailStyle(value: string): value is PlaybarThumbnailStyle {
  return (PLAYBAR_THUMBNAIL_STYLES as readonly string[]).includes(value);
}

export type PlaybarThumbnails = Readonly<{
  shown: boolean;
  style: PlaybarThumbnailStyle;
}>;

/**
 * Whether the play bar draws frames instead of grey boxes, and how.
 *
 * FILM BY DEFAULT, and the trade is the argument for it staying a setting.
 * A bar of frames answers "which shot is that" without a hover, which is the
 * whole reason to want it, and it is the first question anyone asks of the
 * bar. What it costs is the thing the grey bar is good at: box widths are
 * durations, and a run of even grey reads as rhythm — where the cuts fall,
 * which shots are long, where the pace changes. Put pictures in them and the
 * eye reads the pictures, because it always will. So `OFF` is one press away,
 * and it is worth keeping there.
 *
 * TWO SETTINGS, NOT THREE STATES IN ONE. "Show frames" and "which kind" are
 * separate questions and stay separate controls: the style survives being
 * switched off and on, which is what makes toggling frames a comparison you
 * can make twice rather than a choice you re-enter each time.
 *
 * A CONTEXT, NOT A PROP, for the reason `ClipNamesProvider` gives: the
 * consumer is several layers down inside a portalled dialog, the value is
 * constant across the board, and it changes only when someone opens a menu.
 *
 * STILL OFF WITH NO PROVIDER, which is deliberately NOT the shipped default
 * any more. The two answer different questions: the remembered value is what
 * the details view opens on, and this is what a bar rendered with no view
 * around it does. Frames cost a request per cell, so something mounting this
 * component standalone — a story, a probe, anything that has not asked — gets
 * the cheap bar rather than silently fetching a hundred thumbnails.
 */
const PlaybarThumbnailsContext = createContext<PlaybarThumbnails>({
  shown: false,
  style: "cover",
});

export function PlaybarThumbnailsProvider({
  shown,
  style = "cover",
  children,
}: Readonly<{
  shown: boolean;
  style?: PlaybarThumbnailStyle;
  children: React.ReactNode;
}>) {
  // Memoized because the value is an object: a fresh one every render would
  // re-render every consumer on every render of the board, which is the exact
  // cost a context is being used here to avoid.
  const value = useMemo(() => ({ shown, style }), [shown, style]);
  return (
    <PlaybarThumbnailsContext.Provider value={value}>
      {children}
    </PlaybarThumbnailsContext.Provider>
  );
}

/** Whether the play bar should draw frames rather than grey boxes, and how. */
export function usePlaybarThumbnails(): PlaybarThumbnails {
  return useContext(PlaybarThumbnailsContext);
}

/**
 * The last answers chosen, kept at module scope.
 *
 * Deliberately NOT persisted, for the same reason the view count and the reach
 * are not: these are a working posture for a session rather than preferences,
 * and a board reopened tomorrow should start on the plain bar. Held here
 * rather than in the view that renders the controls so that closing the
 * details modal and opening another clip does not reset them — the modal
 * unmounts, and state inside it would go with it.
 */
// THE BAR OPENS AS FILM.
//
// It opened grey, on the argument that a run of even boxes reads as RHYTHM —
// where the cuts fall, which shots are long, where the pace changes — and that
// pictures override that because the eye always reads pictures first. That is
// still true, and it is now the thing you switch TO rather than the thing you
// start from: `OFF` is one press away and the reading it gives is worth
// keeping reachable.
//
// What decided it the other way is that the bar's first job is telling you
// WHICH shot is where, and a row of grey rectangles cannot do that at all —
// it needs a hover per box to answer the question the bar is looked at for.
// Rhythm is what you read second, once you already know what you are looking
// at.
let rememberedShown = true;
let rememberedStyle: PlaybarThumbnailStyle = "filmstrip";

export function lastPlaybarThumbnails(): PlaybarThumbnails {
  return { shown: rememberedShown, style: rememberedStyle };
}

export function rememberPlaybarThumbnails(next: PlaybarThumbnails): void {
  rememberedShown = next.shown;
  rememberedStyle = next.style;
}
