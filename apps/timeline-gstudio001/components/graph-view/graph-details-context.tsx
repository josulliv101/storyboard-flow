"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { ClipDetail } from "@storyboard/timeline-domain";

import type { GraphDetailsStore } from "@/lib/graph-details-store";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

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

/** A timeline's display NAME, read from its gateway document title — the
 *  app's source of truth for a collection's name (the chrome breadcrumb reads
 *  the same field, and the server derives parent clip titles from it).
 *  Undefined until the document is cached; callers fall back to the graph
 *  node name. Re-renders only when THIS id's title changes. */
export function useTimelineTitle(id: string): string | undefined {
  return useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    () => graphDocumentsGateway.peek(id)?.title,
    () => graphDocumentsGateway.peek(id)?.title,
  );
}
