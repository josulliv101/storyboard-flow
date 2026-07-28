import { Skeleton } from "@/components/core/skeleton";

export function GraphViewLoadingSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading graph view"
      className="grid gap-2"
      data-graph-loading-skeleton=""
    >
      <div className="flex h-12 items-center justify-between gap-4 border-b border-zinc-800/70 py-3">
        <Skeleton className="h-4 w-1/3 max-w-64" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton
            key={index}
            data-graph-loading-card=""
            className="aspect-video w-full rounded-lg"
          />
        ))}
      </div>
    </div>
  );
}
