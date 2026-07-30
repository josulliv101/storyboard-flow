// The icon rail's tile styling, shared.
//
// Split out of timeline-sidebar.tsx when board options moved into the rail
// (PL14-005): that menu is rendered by the GRAPH and portalled in, so its
// trigger has to wear the rail's treatment without the graph importing the
// whole sidebar module. Style constants are the only thing it needs, and they
// are the only thing here.

/** A rail tile: the square hit area plus the pill drawn behind the glyph. */
export const SIDEBAR_ICON_BASE = [
  "group/sidebar-item relative flex w-full aspect-square items-center justify-center",
  "transition-all duration-200 focus-visible:outline-none",
  "before:absolute before:inset-2 before:rounded-2xl before:transition-colors before:content-['']",
  "focus-visible:before:ring-2 focus-visible:before:ring-zinc-400",
].join(" ");

/** The glyph inside a tile. Larger than the old h-4: legibility is the point
 *  of the bigger tiles, and a 16px icon in a 72px square reads as a dot.
 *
 *  `relative` is load-bearing: the pill above is an absolutely-positioned
 *  pseudo-element, so a statically-positioned glyph would paint UNDER it. */
export const SIDEBAR_GLYPH = "relative h-7 w-7 [stroke-width:1.5] transition-colors";

export const SIDEBAR_ICON_IDLE =
  "text-zinc-400 before:bg-zinc-900/40 hover:text-zinc-100 hover:before:bg-zinc-800/80";
