"use client";

import { createContext, useContext } from "react";

import { type MediaStripDndAdapter } from "./media-strip-dnd.types";

// Deliberately just the adapter, nothing per-drag: anything that changes
// during a drag (e.g. the manual adapters' overlay position) must NOT live
// here, because every MediaStrip* indirection component reads this context —
// per-move updates would re-render the whole strip subtree. Fast-changing
// drag state belongs in an adapter-local external store subscribed to by
// exactly the leaf that renders it.
export type MediaStripDndRuntimeContextType = {
  adapter: MediaStripDndAdapter;
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
