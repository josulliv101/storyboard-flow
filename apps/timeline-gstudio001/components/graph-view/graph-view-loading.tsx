import { Skeleton } from "@/components/core/skeleton";

/**
 * The board's stand-in while it loads, shaped like the board.
 *
 * ONE SHAPE, RENDERED TWICE. Opening a project passes through two separate
 * fallbacks: the route's `loading.tsx` while the graph LAYOUT awaits its
 * session and boot payloads, and this one while the dynamic
 * `GraphTimelineView` chunk arrives. Both stand in for the same pixels — the
 * layout renders no chrome of its own, just `ClientGraphView` — so they render
 * the same component and the handover is invisible.
 *
 * MEASURED FROM THE RUNNING BOARD rather than sketched, because a placeholder
 * that does not match is just a second layout the eye has to re-read:
 *
 *   header band        57px, bottom border   breadcrumb left, controls right
 *   panel              rounded-xl, bg-zinc-900/60, ring-1 ring-white/10
 *     controls row     49px                  Collection · Media · total · icons
 *     grid             p-3, gap-3            cards 332x220 at 1400 wide
 *
 * The card is a fixed 220 tall with the image area taking the remaining space,
 * which is how the real one is built — its image is flex-sized, NOT
 * `aspect-video`. An aspect-ratio placeholder came out 190 tall against the
 * real 152 and the whole grid shifted when the board arrived.
 *
 * Everything here is a rectangle on purpose. It stands in for chrome whose
 * labels are not known yet, and guessing at "Preview" or "Select" in grey text
 * would read as content that then changes.
 */
export function GraphViewLoadingSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading graph view"
      className="flex flex-col gap-4"
      data-graph-loading-skeleton=""
    >
      {/* Breadcrumb row + the view controls that sit opposite it. */}
      <div className="flex h-14 min-w-0 items-center justify-between gap-3 border-b border-zinc-800/70">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* The board panel — same surface, radius and ring the real one wears, so
          the container does not appear or change shape on handover. */}
      <div className="overflow-hidden rounded-xl bg-zinc-900/60 ring-1 ring-white/10">
        {/* Add-collection / add-media on the left, the focused total centred,
            filter and board options on the right. */}
        <div className="flex h-[49px] min-w-0 items-center gap-2 border-b border-zinc-800/40 px-3">
          <Skeleton className="h-7 w-28 shrink-0 rounded-md" />
          <Skeleton className="h-7 w-20 shrink-0 rounded-md" />
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
          <Skeleton className="mx-auto h-3 w-28" />
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
        </div>

        {/* ONE ROW, not two. The count is unknowable before the read, so the
            choice is which way to be wrong: a short skeleton lets content grow
            downward, a tall one collapses the page when a small board arrives.
            Growing is the quieter of the two, and boards of three or four are
            the common case here. */}
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              data-graph-loading-card=""
              className="grid h-[220px] grid-rows-[1fr_auto] gap-2 rounded-lg bg-zinc-950/40 p-2 ring-1 ring-white/10"
            >
              <Skeleton className="w-full rounded-md" />
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
