"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Whether the item-details view is open (PL10-004, generalized by PL10-012).
 *
 * A MODE, not a per-item flag: details work is done in passes, so opening it
 * once keeps it open as the selection moves from item to item. The view itself
 * decides what to draw for whatever is selected — and for a video it also
 * appears unpinned for the length of a trim drag, so the gesture that needs it
 * summons it whether or not the mode is on.
 *
 * Session-scoped on purpose (state, not storage): the view costs a video
 * element and a filmstrip, and having it survive a reload would mean paying
 * that on every page load for a mode the user may have opened once, days ago.
 */
type ItemDetailsValue = Readonly<{ open: boolean; setOpen: (next: boolean) => void }>;

const ItemDetailsContext = createContext<ItemDetailsValue | null>(null);

const CLOSED: ItemDetailsValue = { open: false, setOpen: () => {} };

export function ItemDetailsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <ItemDetailsContext.Provider value={value}>{children}</ItemDetailsContext.Provider>;
}

/** Degrades to "never open" with no provider, so cards render standalone
 *  (stories, isolated surfaces) without one. */
export function useItemDetails(): ItemDetailsValue {
  return useContext(ItemDetailsContext) ?? CLOSED;
}
