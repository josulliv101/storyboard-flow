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
/**
 * How much wider the clip being worked on is than the ones beside it.
 *
 * 7:4. The neighbours have to stay big enough to read a frame in — that is
 * the entire reason they are whole panels rather than thumbnails — and the
 * centre has to be unmistakably the subject without the row turning into one
 * panel with two slivers. Below about 1.5 the emphasis stops reading as
 * deliberate and looks like a rounding error; above about 2 the neighbours
 * stop being usable and the layout would be better off showing one.
 */
const CENTRE_TO_NEIGHBOUR = 1.75;

/**
 * The details view's own width, in pixels, published by the view onto itself.
 *
 * Written from a ResizeObserver rather than derived in CSS — see the note in
 * `panelWidthsFor` for why a container unit cannot do this job.
 */
export const DETAILS_BASIS_VAR = "--details-basis";

/**
 * The two widths for a given count: the clip being worked on, and everything
 * else.
 *
 * EVERY PANEL IS FULLY VISIBLE NOW. The old layout gave all panels one width
 * and let the outermost pair hang half off each edge, which is what made
 * "show three" mean "one whole and two halves". Sizing the centre separately
 * buys the same emphasis without spending it on cropping:
 *
 *   (count - 1) x N  +  1.75 x N  +  (count - 1) gaps  =  viewport - padding
 *
 * so N = (100vw - 3rem - (count-1)rem) / (count - 1 + 1.75).
 *
 * THE ROW'S TRANSFORM DOES NOT NEED THE CENTRE WIDTH, which is the happy part
 * of this arithmetic. Centring panel k means translating by
 * `-(N + gap) * (k - (n-1)/2)` — the centre panel's extra width sits
 * symmetrically about its own middle, so it cancels out of the centring
 * entirely and the step stays one uniform neighbour-width. See the row
 * transform in `graph-item-details-modal.tsx`.
 *
 * The caps survive so a very wide monitor does not hand the middle panel half
 * a metre of screen; below them the count drives the layout.
 */
export function panelWidthsFor(
  count: ViewCount,
): Readonly<{ centre: string; neighbour: string }> {
  // AGAINST THE VIEW, NOT THE VIEWPORT (PL15-029). This was `100vw`, which was
  // exactly right while the view was a fixed scrim: the scrim WAS the viewport.
  // It is a region inside the content area now, narrower than the window by the
  // rail (72px or 260px) and by `main`'s own padding, so `100vw` would size
  // every panel for a box the row does not get.
  //
  // A CSS VARIABLE, AND NOT `cqw`, WHICH IS THE PART THAT TOOK A SECOND PASS.
  // `100cqw` on the view looks right and measures right for the PANELS — but
  // container units resolve against the nearest ancestor container, names
  // ignored, and every panel declares `@container` for its own internals. So
  // the same expression means "the view" when applied to a panel and "the
  // panel" when applied to anything INSIDE one.
  //
  // That difference is not academic: the heading deliberately reuses this
  // width so it is sized by its ROLE rather than by the box it sits in, which
  // is what keeps it still while the box animates. `vw` was global and immune;
  // `cqw` made it follow the box, and
  // `TheNameDoesNotReTruncateWhileTheCardResizes` caught it — 173px becoming
  // 68 the moment the story shoved the boxes onto each other's widths.
  //
  // The view publishes its own width in pixels instead. A plain length cannot
  // be recaptured by a nested container, so it means the same thing at every
  // depth. The `100vw` fallback is the old behaviour exactly, which is what
  // any surface rendering a panel without the view around it should get.
  const available = `(var(${DETAILS_BASIS_VAR}, 100vw) - 3rem - ${count - 1}rem)`;
  const share = count - 1 + CENTRE_TO_NEIGHBOUR;
  return {
    neighbour: `min(34rem, ${available} / ${share})`,
    centre: `min(60rem, ${available} * ${CENTRE_TO_NEIGHBOUR} / ${share})`,
  };
}
