"use client";

import { createContext, useContext } from "react";

/**
 * Whether a clip card stamps its NAME over the artwork.
 *
 * OFF BY DEFAULT, and the default is the whole reason this is a setting rather
 * than a fact. A name over the picture covers the picture — on a strip, where a
 * clip's width is its duration, a short clip is mostly name. The board is for
 * reading FRAMES first; the name is there when you are looking for a
 * particular clip rather than looking at the cut.
 *
 * It gates only the overlay on the artwork. The GRID caption underneath is a
 * different surface with room of its own and keeps its name either way — which
 * is also why the overlay was already hidden there: stamping it on the picture
 * as well would repeat the line directly beneath it.
 *
 * A CONTEXT, NOT A PROP, because the consumer is a memoized leaf several
 * layers down and the value changes only when someone opens a menu and clicks.
 * Threading it would put a new prop through every card shell for a value that
 * is constant across the whole board; a context re-renders exactly the cards
 * that draw a name, exactly when the answer changes. It is the pattern this
 * tree already uses for board-wide facts (`ItemDetailsProvider`,
 * `TagFilterProvider`, `FlatItemsProvider`).
 *
 * DEFAULTS TO FALSE WITH NO PROVIDER, so a card rendered outside the board — a
 * story, the drag ghost — behaves like the shipped default rather than
 * throwing or silently opting in.
 */
const ClipNamesContext = createContext(false);

export function ClipNamesProvider({
  shown,
  children,
}: Readonly<{ shown: boolean; children: React.ReactNode }>) {
  return <ClipNamesContext.Provider value={shown}>{children}</ClipNamesContext.Provider>;
}

/** Whether this card should stamp its name over the artwork. */
export function useClipNamesShown(): boolean {
  return useContext(ClipNamesContext);
}
