"use client";

import { useSearchParams } from "next/navigation";

/**
 * TWO WAYS THE DETAILS VIEW CAN RELATE TO THE PREVIEW PANE (PL16-005).
 *
 * Both are wanted at once so they can be compared side by side on the same
 * build, which is why this is a runtime switch rather than a decision taken in
 * code and a commit reverted to see the other one.
 *
 * `standdown` (the default, PL16-003) unmounts the pane for the duration. The
 *   view then IS the content area, with nothing running behind it.
 *
 * `cover` leaves the pane mounted and paints the view over it, the way the view
 *   already covers the board. Costs a second video decoding behind something
 *   nobody can see; buys a pane that is exactly where it was when you come back
 *   out, with no re-open.
 *
 * WHAT DOES NOT CHANGE WITH THE MODE: the pane never TAKES the scrub frame
 * while the view is up. `usePublishTrimPreview` reporting that it did is what
 * tells the deck not to show a preview of its own, and a covered pane showing
 * the frame behind the view would be showing it to nobody. Keeping that
 * constant is what makes the two modes comparable — the only difference between
 * them is what happens to the pane, not what the deck does.
 */
export type DetailsPreviewMode = "standdown" | "cover";

/** The query key. `?previewmode=cover` — same shape as `?dev=1` and
 *  `?surface=grid`, which is how every other switch in this view is reached. */
export const DETAILS_PREVIEW_MODE_PARAM = "previewmode";

export function useDetailsPreviewMode(): DetailsPreviewMode {
  // Read from the URL rather than threaded from the page: the graph tree mounts
  // client-only (`ssr: false` in client-graph-view), so this has no prerender
  // or Suspense implications — the same note the surface and dev params carry.
  const value = useSearchParams().get(DETAILS_PREVIEW_MODE_PARAM);
  return value === "cover" ? "cover" : "standdown";
}
