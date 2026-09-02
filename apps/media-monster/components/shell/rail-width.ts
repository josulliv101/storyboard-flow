/**
 * The rail's width, as a custom property and the two numbers it takes.
 *
 * FRAMEWORK-NEUTRAL AND NOT A CLIENT MODULE, deliberately. The root layout is a
 * server component and imports these; in the source app the equivalent
 * constants had to be split out of `timeline-sidebar.tsx` for exactly that
 * reason — that file carries `"use client"`, and a server component reaching
 * into it typechecks perfectly and fails at request time. Keeping the numbers
 * somewhere with no runtime is what stops that seam from ever existing here.
 *
 * Ported from `sidebar-rail-preference.ts` and `sidebar-icon-styles.ts` in
 * `apps/timeline-gstudio001`, which are 65 and 187 lines respectively and carry
 * the cookie parser, the tile styles and the glyph insets alongside these. Only
 * the widths came over: there is no rail yet to have a preference about, and
 * copying a cookie parser this app cannot use would be copying a decision
 * rather than a value. The rest arrives with the rail.
 */

/**
 * Published to the document so surfaces BESIDE the rail can be offset by it.
 *
 * A variable rather than a literal is the seam: one writer, any number of
 * readers that keep working when the number moves. The source app learned this
 * from a drawer that hardcoded `ml-[72px]` and would have slid under the rail
 * the moment it could widen.
 */
export const RAIL_WIDTH_VAR = "--sw-rail-width";

/** The rail's collapsed width, and what the shell reserves today. */
export const RAIL_WIDTH_PX = 72;

/**
 * The rail's width with labels showing.
 *
 * Unused until the rail lands, and here anyway because it is the other half of
 * what `RAIL_WIDTH_VAR` can hold — a reader sizing something against the
 * variable needs to know its range, not just its current value. THE WORDMARK
 * sets this number, not the labels.
 */
export const RAIL_OPEN_WIDTH_PX = 240;
