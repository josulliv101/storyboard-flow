"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { ClipDetail } from "@storyboard/timeline-domain";

import type { GraphDetailsStore } from "@/lib/graph-details-store";

const GraphDetailsStoreContext = createContext<GraphDetailsStore | null>(null);

export function GraphDetailsProvider({
  store,
  children,
}: Readonly<{
  store: GraphDetailsStore;
  children: React.ReactNode;
}>) {
  return (
    <GraphDetailsStoreContext.Provider value={store}>
      {children}
    </GraphDetailsStoreContext.Provider>
  );
}

export function useGraphDetailsStore(): GraphDetailsStore {
  const store = useContext(GraphDetailsStoreContext);
  if (store === null) {
    throw new Error("useGraphDetailsStore must be used inside the graph view's provider tree.");
  }
  return store;
}

/** Subscribe to one detail entry so unrelated hydration does not re-render this consumer. */
export function useClipDetail(id: string): ClipDetail | undefined {
  const store = useGraphDetailsStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(id),
    () => store.get(id),
  );
}
