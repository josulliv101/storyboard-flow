"use client";

import dynamic from "next/dynamic";

const GraphTimelineView = dynamic(
  () => import("./graph-timeline-view").then((module) => module.GraphTimelineView),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-3" aria-label="Loading graph view">
        <div className="h-8 w-1/2 animate-pulse rounded-lg bg-zinc-900" />
        <div className="h-28 w-full animate-pulse rounded-lg bg-zinc-900" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-zinc-900/60" />
      </div>
    ),
  },
);

export function ClientGraphView({ projectId }: { projectId: string }) {
  return <GraphTimelineView projectId={projectId} />;
}
