import { Skeleton } from "@/components/core/skeleton";

/**
 * The board's stand-in while it loads.
 *
 * ONE SHAPE, RENDERED TWICE. Opening a project passes through two separate
 * fallbacks: the route's `loading.tsx` while the graph LAYOUT awaits its
 * session and boot payloads, and this one while the dynamic `GraphTimelineView`
 * chunk arrives. They used to look different — a bordered card grid with two
 * text lines, then bare rounded rectangles — so the eight cards visibly changed
 * shape mid-load and it read as two separate loads rather than one.
 *
 * The layout renders no chrome of its own (see `graph/layout.tsx`), so both
 * fallbacks stand in for the same pixels and there is no reason for them to
 * differ. `graph/loading.tsx` renders this inside the layout's own container
 * classes, which makes the handover invisible.
 *
 * The card carries a caption row because the real one does. A bare rectangle
 * pops a second time when the board arrives and the captions appear.
 */
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
          <div key={index} data-graph-loading-card="" className="grid gap-2">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
