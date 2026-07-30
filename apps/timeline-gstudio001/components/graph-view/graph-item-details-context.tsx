"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useCollectionsStore } from "@storyboard/ui/dnd-collections";

import { GRAPH_ITEM_ACTION_EVENT, type GraphItemAction } from "@/lib/graph-view-events";

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
  return (
    <ItemDetailsContext.Provider value={value}>
      <ItemDetailsActionListener onOpen={setOpenId} />
      {children}
    </ItemDetailsContext.Provider>
  );
}

/**
 * Opens the details view when the sidebar's Edit action fires (PL13-009).
 *
 * The listener lives HERE rather than in the item-actions bridge, which is
 * mounted outside this provider and would only ever see the closed fallback.
 * The details feature owning its own trigger also means the rail knows nothing
 * about `openId` — it sends a verb and this decides what that means.
 *
 * Reads the selection at the moment of the press rather than tracking it: the
 * event IS the intent, and anything else would be a second copy of state the
 * store already holds. Refuses anything that is not exactly one item — the
 * sidebar disables the control past one, but a window event carries no proof
 * of who sent it.
 */
function ItemDetailsActionListener({
  onOpen,
}: Readonly<{ onOpen: (id: string) => void }>) {
  const store = useCollectionsStore();

  useEffect(() => {
    const onAction = (event: Event) => {
      if ((event as CustomEvent<GraphItemAction>).detail !== "details") return;
      const selected = [...store.getSnapshot().interaction.selectedIds];
      if (selected.length !== 1) return;
      onOpen(selected[0] as string);
    };
    window.addEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
    return () => window.removeEventListener(GRAPH_ITEM_ACTION_EVENT, onAction);
  }, [store, onOpen]);

  return null;
}

/** Degrades to "never open" with no provider, so cards render standalone
 *  (stories, isolated surfaces) without one. */
export function useItemDetails(): ItemDetailsValue {
  return useContext(ItemDetailsContext) ?? CLOSED;
}
