import { GraphViewLoadingSkeleton } from "@/components/graph-view/graph-view-loading";

/**
 * The fallback while a project's LAYOUT loads — its session and boot payloads.
 *
 * IT HAS TO LIVE HERE, one segment up, and that is not obvious: a `loading.tsx`
 * wraps its segment's PAGE and sits inside that segment's layout, so
 * `graph/loading.tsx` could never cover `graph/layout.tsx`'s own await. Putting
 * one there also renders a second skeleton BELOW the board on every drill-in,
 * because the layout renders the board and then its children.
 *
 * Renders the same skeleton the dynamic-import fallback does, inside the same
 * container classes `graph/layout.tsx` uses. Opening a project passes through
 * both in sequence, and they used to look different — a bordered card grid with
 * two text lines, then bare rounded rectangles — so the eight cards changed
 * shape halfway through and it read as two loads instead of one.
 */
export default function TimelineLoading() {
  return (
    <div
      aria-label="Loading project"
      className="graph-view-theme flex w-full flex-col gap-5"
    >
      <GraphViewLoadingSkeleton />
    </div>
  );
}
