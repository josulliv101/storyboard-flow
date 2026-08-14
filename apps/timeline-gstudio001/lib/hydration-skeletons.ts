/**
 * How many placeholder cards to draw while a focused collection hydrates.
 *
 * Drilling into a collection navigates immediately, but its clips arrive on a
 * fetch — so the surface is genuinely empty for a beat and the user is looking
 * at nothing. The count is knowable in advance: a collection's STORED SUMMARY
 * carries `itemCount`, written by its parent, so the placeholder row can be the
 * right length before a single clip has loaded and the surface does not jump
 * when they land.
 *
 * Pure, and in a `.ts` file, because the app's vitest cannot parse `.tsx` —
 * extraction is what makes this testable at all.
 */

/**
 * The ceiling. A 400-clip collection must not mount 400 placeholder cards to
 * describe a wait — past a screenful the row has already said "content is
 * coming, roughly this shape" and every further card is cost with no message.
 */
export const MAX_HYDRATION_SKELETONS = 12;

/**
 * What to draw when the summary has no `itemCount`: an older document, or a
 * collection reached before its parent's summary was written.
 *
 * Deliberately small. Guessing HIGH and resolving to two clips is a visible
 * collapse; guessing low and resolving to twelve just fills in. When the true
 * count is unknown the honest signal is "something is coming", not a number.
 */
export const FALLBACK_HYDRATION_SKELETONS = 3;

export type HydrationSkeletonInput = Readonly<{
  /** The focused collection's `hydrated` flag. `undefined` for a collection
   *  with no side-table entry yet, which is itself a pre-hydration state. */
  hydrated: boolean | undefined;
  /** The stored summary's child count, when the parent wrote one. */
  itemCount: number | undefined;
  /** How many children the graph is ALREADY rendering for this collection. */
  renderedChildren: number;
}>;

/**
 * `0` means draw nothing — either there is no wait, or a placeholder would be
 * a lie.
 *
 * The order of these rules is the whole design:
 *
 *   HYDRATED WINS outright. Once the clips are in the graph there is nothing
 *   to wait for, whatever the other two say.
 *
 *   ANYTHING ALREADY ON SCREEN suppresses them, even mid-hydration. Skeletons
 *   next to real cards read as broken cards rather than as loading ones, and
 *   this is reachable: a re-hydration after a remote change re-runs the fetch
 *   with the previous children still mounted.
 *
 *   A STORED ZERO IS A REAL ANSWER. An empty collection is empty, and its
 *   empty state is the correct thing to show. Drawing skeletons there is the
 *   worst case of all — a wait that never resolves, because nothing is coming.
 *   This is why `itemCount === 0` is separated from `itemCount === undefined`
 *   rather than both falling through a truthiness check.
 */
export function hydrationSkeletonCount(input: HydrationSkeletonInput): number {
  const { hydrated, itemCount, renderedChildren } = input;

  if (hydrated === true) return 0;
  if (renderedChildren > 0) return 0;
  if (itemCount === 0) return 0;
  if (itemCount === undefined) return FALLBACK_HYDRATION_SKELETONS;

  // A negative or fractional count is a corrupt summary, not a layout
  // instruction — floor it into range rather than handing `Array.from` a
  // length it will throw on.
  if (!Number.isFinite(itemCount) || itemCount < 0) return FALLBACK_HYDRATION_SKELETONS;

  return Math.min(Math.floor(itemCount), MAX_HYDRATION_SKELETONS);
}
