"use client";

import { useContext, useState } from "react";

import {
  VirtualStrip,
  getChildren,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";

import { useClipDetail, useGraphDetailsStore } from "./graph-details-context";
import { hydrateTimeline } from "./graph-hydration";
import { GraphViewNavContext } from "./graph-navigation";
import { TIMELINE_PPS } from "./graph-view-config";

function SubTimelineSection({
  collectionId,
  name,
  collapsed,
  onToggleCollapsed,
}: Readonly<{
  collectionId: NodeId;
  name: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}>) {
  const nav = useContext(GraphViewNavContext);
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const id = collectionId as string;
  const detail = useClipDetail(id);
  const hydrated = detail?.hydrated === true;
  const liveCount = useCollectionsSelector((snapshot) =>
    getChildren(snapshot.graph, collectionId).length,
  );

  return (
    <section aria-label={`Sub-timeline: ${name}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="h-3 w-3 rounded-sm border border-dashed border-sky-500/60 bg-sky-500/20" />
        <h3 className="text-sm font-semibold text-zinc-100">{name}</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {hydrated ? liveCount : (detail?.itemCount ?? 0)} clips
        </span>
        {!hydrated && (
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">
            loading…
          </span>
        )}
        <span className="grow" />
        {!hydrated && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void hydrateTimeline(store, detailsStore, id);
            }}
          >
            Load inline
          </Button>
        )}
        {hydrated && (
          <Button type="button" variant="ghost" size="sm" onClick={onToggleCollapsed}>
            {collapsed ? "Expand" : "Collapse"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => nav?.openTimeline(collectionId)}
        >
          Focus
        </Button>
      </div>

      {hydrated && !collapsed && (
        <VirtualStrip
          collectionId={collectionId}
          pixelsPerSecond={TIMELINE_PPS}
          itemHeight={64}
          itemDragActivation="hold"
          className="bg-black/20"
        />
      )}
    </section>
  );
}

export function SubTimelines({ focusedId }: Readonly<{ focusedId: string }>) {
  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());

  const collections = getChildren(graph, parseNodeId(focusedId)).filter(
    (childId) => graph.nodesById.get(childId)?.kind === "collection",
  );
  if (collections.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {collections.map((collectionId) => {
        const node = graph.nodesById.get(collectionId);
        if (node?.kind !== "collection") return null;
        const id = collectionId as string;
        return (
          <SubTimelineSection
            key={id}
            collectionId={collectionId}
            name={node.name}
            collapsed={collapsedIds.has(id)}
            onToggleCollapsed={() =>
              setCollapsedIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        );
      })}
    </div>
  );
}
