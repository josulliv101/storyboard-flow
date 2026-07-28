"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the trim panel is pinned open (PL10-004).
 *
 * A MODE, not a per-clip flag: trimming is done in passes, so pinning it once
 * keeps it open as the selection moves from clip to clip. The panel itself
 * decides what to draw — it follows the selected video, and it also appears
 * unpinned for the length of a trim drag, so the gesture that needs it summons
 * it whether or not the mode is on.
 *
 * Session-scoped on purpose (state, not storage): the panel costs a video
 * element and a filmstrip, and having it survive a reload would mean paying
 * that on every page load for a mode the user may have pinned once, days ago.
 */
type TrimPanelValue = Readonly<{ pinned: boolean; setPinned: (next: boolean) => void }>;

const TrimPanelContext = createContext<TrimPanelValue | null>(null);

const CLOSED: TrimPanelValue = { pinned: false, setPinned: () => {} };

export function TrimPanelProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [pinned, setPinned] = useState(false);
  const value = useMemo(() => ({ pinned, setPinned }), [pinned]);
  return <TrimPanelContext.Provider value={value}>{children}</TrimPanelContext.Provider>;
}

/** Degrades to "never pinned" with no provider, so cards render standalone
 *  (stories, isolated surfaces) without one. */
export function useTrimPanel(): TrimPanelValue {
  return useContext(TrimPanelContext) ?? CLOSED;
}
