"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@storyboard/ui/core/skeleton";

const DndCollectionsShowcase = dynamic(
  () =>
    import("./dnd-collections-showcase").then(
      (module) => module.DndCollectionsShowcase,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6" aria-label="Loading drag-and-drop collections">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Skeleton className="h-[36rem] w-full rounded-2xl" />
          <Skeleton className="h-[36rem] w-full rounded-2xl" />
        </div>
      </div>
    ),
  },
);

export function ClientDndCollectionsShowcase() {
  return <DndCollectionsShowcase />;
}
