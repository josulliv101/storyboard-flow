"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Marks the bounded virtual-strip window as safe to load eagerly. The same
 * card renderer is used in grid view, where eager loading would request every
 * video at once, so lazy remains the default outside this boundary.
 *
 * ITS OWN MODULE, and that is not tidiness. This is a module-level
 * `createContext`, and a cycle around one of those fails at EVALUATION time
 * rather than at the type level — the trap the `graph-preview` split hit
 * (#281). The card that reads it and the board that provides it both import
 * from here and never from each other.
 */
const VideoFrameLoadingContext = createContext<"lazy" | "eager">("lazy");

export function VideoFrameLookAhead({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <VideoFrameLoadingContext.Provider value="eager">
      {children}
    </VideoFrameLoadingContext.Provider>
  );
}

/** The `loading` attribute a card's frames should carry here. */
export function useVideoFrameLoading(): "lazy" | "eager" {
  return useContext(VideoFrameLoadingContext);
}
