"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  parseNodeId,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { useGraphDetailsStore } from "./graph-details-context";

type GraphViewNav = Readonly<{
  openTimeline: (nodeId: NodeId) => void;
}>;

export const GraphViewNavContext = createContext<GraphViewNav | null>(null);

export function GraphViewNavProvider({
  projectId,
  focusedId,
  children,
}: Readonly<{
  projectId: string;
  focusedId: string;
  children: React.ReactNode;
}>) {
  const router = useRouter();
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  const value = useMemo<GraphViewNav>(
    () => ({
      openTimeline: (nodeId) => {
        const timelineId =
          detailsStore.get(nodeId as string)?.duplicateOfTimelineId ?? (nodeId as string);
        if (timelineId === focusedId) return;

        const base = `/timeline/${encodeURIComponent(projectId)}/graph`;
        if (timelineId === projectId) {
          router.push(base);
          return;
        }

        const { graph } = store.getSnapshot();
        const chain: string[] = [timelineId];
        let parent = graph.parentById.get(parseNodeId(timelineId)) ?? null;
        while (parent !== null && (parent as string) !== projectId) {
          chain.unshift(parent as string);
          parent = graph.parentById.get(parent) ?? null;
        }
        if ((parent as string | null) !== projectId) return;
        router.push(`${base}/${chain.map(encodeURIComponent).join("/")}`);
      },
    }),
    [detailsStore, focusedId, projectId, router, store],
  );

  return <GraphViewNavContext.Provider value={value}>{children}</GraphViewNavContext.Provider>;
}

/** Keyboard drill-in boundary for collection and duplicate-reference cards. */
export function OpenKeyBoundary({ children }: Readonly<{ children: React.ReactNode }>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "o" && event.key !== "O") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (store.getSnapshot().interaction.isDragging) return;

    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable=true]")) return;
    const id = target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    if (!id) return;

    const node = store.getSnapshot().graph.nodesById.get(parseNodeId(id));
    const opensTimeline =
      node?.kind === "collection" || detailsStore.get(id)?.duplicateOfTimelineId !== undefined;
    if (!opensTimeline) return;

    event.preventDefault();
    nav?.openTimeline(parseNodeId(id));
  };

  return (
    <div style={{ display: "contents" }} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}
