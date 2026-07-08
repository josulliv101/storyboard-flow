"use client";

import { createContext, useContext } from "react";

import { type MediaStripDndAdapter } from "./media-strip-dnd.types";

export type MediaStripDndRuntimeContextType = {
  adapter: MediaStripDndAdapter;
  overlayPosition: { x: number; y: number } | null;
};

export const MediaStripDndRuntimeContext =
  createContext<MediaStripDndRuntimeContextType | null>(null);

export function useMediaStripDndRuntime() {
  const context = useContext(MediaStripDndRuntimeContext);
  if (!context) {
    throw new Error("MediaStrip DnD components must be rendered inside MediaStripDndProvider.");
  }
  return context;
}
