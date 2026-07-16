"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@storyboard/ui/core/skeleton";

const GraphTimeline = dynamic(
  () => import("./graph-timeline").then((module) => module.GraphTimeline),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6" aria-label="Loading graph timeline">
        <Skeleton className="h-10 w-1/2 rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    ),
  },
);

export function ClientGraphTimeline() {
  return <GraphTimeline />;
}
