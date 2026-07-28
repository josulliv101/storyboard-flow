"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * WHICH item has its details open (PL10-004 → PL11-002).
 *
 * It used to be a boolean mode paired with "whatever is selected", because the
 * only trigger was a toolbar button. The trigger now lives on the card itself,
 * and a card can be pressed without being the selection — so the open item is
 * named here rather than inferred. `null` is closed.
 *
 * Session-scoped on purpose (state, not storage): the view costs a video
 * element and a filmstrip, and having it survive a reload would mean paying
 * that on every page load for something the user opened once, days ago.
 */
type ItemDetailsValue = Readonly<{
  openId: string | null;
  setOpenId: (next: string | null) => void;
}>;

const ItemDetailsContext = createContext<ItemDetailsValue | null>(null);

const CLOSED: ItemDetailsValue = { openId: null, setOpenId: () => {} };

export function ItemDetailsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <ItemDetailsContext.Provider value={value}>{children}</ItemDetailsContext.Provider>;
}

/** Degrades to "never open" with no provider, so cards render standalone
 *  (stories, isolated surfaces) without one. */
export function useItemDetails(): ItemDetailsValue {
  return useContext(ItemDetailsContext) ?? CLOSED;
}
