// The icon rail's tile styling, shared.
//
// Split out of timeline-sidebar.tsx when board options moved into the rail
// (PL14-005): that menu is rendered by the GRAPH and portalled in, so its
// trigger has to wear the rail's treatment without the graph importing the
// whole sidebar module. Style constants are the only thing it needs, and they
// are the only thing here.

/**
 * The rail's collapsed width, and the tile edge that follows from it. Exported
 * because the glyph insets below are derived from it and the drawers beside
 * the rail are offset by it — several places that must agree, and did not when
 * the number was typed into each of them.
 */
export const RAIL_WIDTH_PX = 72;

/**
 * The rail's width with labels showing.
 *
 * THE WORDMARK SETS THIS, not the labels. It was 232px, sized for the longest
 * label the rail then carried ("All items in order") — and that control has
 * since moved to the board's controls row, while the mark grew from "SW" to
 * "Storyboard Workbench". Measured, the mark ends 229px in, which fit 232 by
 * three pixels: enough today and not enough to survive a font fallback
 * rendering a fraction wider.
 *
 * Collection names are the other tenant here and they are user-authored, so no
 * width could ever be "enough" for them; they truncate, which degrades to an
 * ellipsis rather than shoving the rail's rhythm out of line.
 */
export const RAIL_OPEN_WIDTH_PX = 240;

/**
 * On the rail ALWAYS, open or closed — and the hook every tile style below
 * selects on.
 *
 * A descendant selector rather than props, so widening the rail does not mean
 * editing every tile's call site (there are seven, and one missed would be a
 * tile that stayed square while its neighbours grew). It is also what protects
 * the ONE tile that is not in the rail: the graph portals its board-options
 * trigger out of the board wearing `SIDEBAR_ICON_BASE` (PL14-005), and it is
 * not inside `.rail`, so none of this reaches it by construction rather than
 * by remembering.
 *
 * The geometry hangs off THIS rather than off `rail-open`, and the reason is
 * the collapse animation. Width transitions over 200ms; a class is added and
 * removed in one frame. So when the tile's layout depended on `rail-open`,
 * collapsing re-centred every glyph INSTANTLY inside a tile that was still
 * 232px wide, and each icon flew from the middle back to the edge while the
 * rail caught up. Expanding looked fine because the same race runs the
 * harmless way round.
 *
 * The trick is that leading and centred are the SAME PIXEL at 72px wide:
 * `justify-start` with a 22px inset puts a 28px glyph exactly where centring
 * it did. So the tile can wear one geometry in both states, nothing has to be
 * timed against the transition, and the icons simply never move.
 */
export const RAIL_CLASS = "rail";

/**
 * On the rail only while it is OPEN — a state marker, deliberately not a
 * geometry hook.
 *
 * Nothing below selects on it, and that is the point rather than an oversight:
 * see `RAIL_CLASS`. Anything laid out from this class is laid out against a
 * width that has not finished animating. It stays because the open state is
 * worth naming in the DOM beside `data-sidebar-expanded`, and because the test
 * that forbids the tile styles from mentioning it needs something to name.
 */
export const RAIL_OPEN_CLASS = "rail-open";

/**
 * The two widths as LITERAL Tailwind classes.
 *
 * Tailwind scans source text, so `w-[${RAIL_OPEN_WIDTH_PX}px]` compiles to
 * nothing at all and the rail silently refuses to open — the failure looks
 * like a broken toggle, not like a missing class. These have to be written
 * out; `sidebar-icon-styles.test.ts` is what keeps them equal to the numbers
 * above, which are what the CSS variable is published from.
 */
export const RAIL_WIDTH_CLASS = {
  collapsed: "w-[72px]",
  open: "w-[240px]",
} as const;

/**
 * A tile's BOX, which is not the same thing as the shape you see.
 *
 * The box is a full-width square at rail width — that is what keeps the rail's
 * rhythm even and the tiles on one grid. What you actually see is the
 * `::before` layer, inset from that box, so every fill (idle, hover, pressed,
 * disabled) paints as a rounded pill floating inside its square rather than a
 * band running edge to edge.
 *
 * ON THE RAIL the square becomes a row of the same HEIGHT and the glyph leads
 * rather than centring — unconditionally, in both states. The pill follows the
 * row, which is what makes an expanded item read as one target with its label
 * rather than as an icon with text loose beside it.
 */
export const SIDEBAR_ICON_BASE = [
  "group/sidebar-item relative flex w-full aspect-square items-center justify-center",
  "transition-all duration-200 focus-visible:outline-none",
  "before:absolute before:inset-2 before:rounded-2xl before:transition-colors before:content-['']",
  "focus-visible:before:ring-2 focus-visible:before:ring-zinc-400",
  // Not keyed to the open state — see RAIL_CLASS. 72px is exactly what
  // `aspect-square` already gave at 72px wide.
  "[.rail_&]:aspect-auto [.rail_&]:h-[72px] [.rail_&]:justify-start",
].join(" ");

/** The glyph inside a tile. Larger than the old h-4: legibility is the point
 *  of the bigger tiles, and a 16px icon in a 72px square reads as a dot.
 *
 *  `relative` is load-bearing: the pill above is an absolutely-positioned
 *  pseudo-element, so a statically-positioned glyph would paint UNDER it.
 *
 *  THE GLYPH NEVER MOVES — not opening, and not closing. 22px is exactly where
 *  centring a 28px glyph in the 72px tile already put it — `(72 - 28) / 2` — so
 *  leading it lands on the same pixel, and the column of icons stays put while
 *  the labels appear beside them. */
export const SIDEBAR_GLYPH =
  "relative h-7 w-7 [stroke-width:1.5] transition-colors [.rail_&]:ml-[22px]";

/** The avatar's twin of `SIDEBAR_GLYPH`'s inset. It is 32px rather than 28,
 *  so it sits 20px in — `(72 - 32) / 2` — and needs its own number to hold
 *  still for the same reason. */
export const SIDEBAR_AVATAR_INSET = "[.rail_&]:ml-5";

export const SIDEBAR_ICON_IDLE =
  "text-zinc-400 before:bg-zinc-900/40 hover:text-zinc-100 hover:before:bg-zinc-800/80";
