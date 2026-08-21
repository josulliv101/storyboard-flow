// How many panels the details view shows at once, and how wide each is.
// Its own module because the count is a layout decision two components
// share — the carousel that lays the row out and the picker that sets it.

export const VIEW_COUNTS = [3, 5] as const;
export type ViewCount = (typeof VIEW_COUNTS)[number];

/**
 * The last count chosen, kept at module scope.
 *
 * Deliberately NOT persisted to storage: it is a working posture for a
 * session, not a preference, and a board reopened tomorrow should start at the
 * close reading rather than at whatever the last question happened to need.
 */
let rememberedViewCount: ViewCount = 3;

// Read and written rather than exported directly: an ESM import is a
// read-only binding, so a consumer cannot assign to the `let` across a
// module edge. The pair also makes the two operations nameable, which a
// bare mutable export never was.
export function lastViewCount(): ViewCount {
  return rememberedViewCount;
}

export function rememberViewCount(count: ViewCount): void {
  rememberedViewCount = count;
}

/**
 * A panel's width for a given count, chosen so that exactly `count` panels are
 * ON SCREEN with the middle one centred.
 *
 * THE TWO OUTER PANELS ARE HALF VISIBLE, which is both what makes the
 * arithmetic close and what makes the count mean what it says: `count - 2`
 * panels sit fully in view, the two at the edges show half of themselves, and
 * the widths add up to exactly one viewport.
 *
 *   (count - 2) x W  +  2 x W/2  =  (count - 1) x W  =  viewport - padding - gaps
 *
 * The first attempt scaled the width BY the count — three-fifths for five, a
 * fifth for fifteen — which made the panels narrower without making more of
 * them fit, so five showed the same three it always had. Fitting N panels is a
 * different question from making N panels thinner, and only one of them is
 * what "show five" means.
 *
 * The 48rem cap survives so a very wide monitor does not hand the middle panel
 * half a metre of screen; below that the count drives the layout.
 *
 * WHY THE TOP END IS FIVE. Nine shipped for a while and fifteen was tried
 * before it: at 1600px those are about 185px and 95px a panel, which is a
 * column rather than a panel at fifteen and, at nine, a picture you can read
 * but a row of controls you cannot comfortably hit. Five keeps every panel
 * wide enough to work in, and the reach across the timeline that nine bought
 * is what the bar above is for.
 */
export function panelWidthFor(count: ViewCount): string {
  // 3rem is the modal's own padding (p-6 either side); the gaps are one rem
  // apiece, and there are `count - 1` of them between `count` panels.
  return `min(48rem, (100vw - 3rem - ${count - 1}rem) / ${count - 1})`;
}
