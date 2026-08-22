// HOW FAR THE BAR REACHES either side of the clip being worked on.
//
// Its own module for the same reason the view count has one: the reach is a
// layout decision shared by the thing that lays the bar out and the picker
// that sets it, and neither should own the other's constant.
//
// A number is a COUNT OF CLIPS EITHER SIDE, so 10 puts 21 clips on the bar
// when the subject has that many neighbours — ten behind, the subject, ten
// ahead. Five is the tightest, and roughly the run the strip below can show
// at once: at that reach the bar stops being a map and becomes a close look
// at the cut you are working on. `"all"` is the whole collection, which is what the bar did before
// there was a choice and is still the right answer when the question is
// "where does this sit in the sequence".

export const BAR_REACHES = [5, 10, 20, "all"] as const;
export type BarReach = (typeof BAR_REACHES)[number];

/**
 * The last reach chosen, kept at module scope.
 *
 * Deliberately NOT persisted, and for the same reason as the view count: it
 * is a working posture for a session rather than a preference, and a board
 * reopened tomorrow should start close in.
 */
let rememberedReach: BarReach = 10;

export function lastBarReach(): BarReach {
  return rememberedReach;
}

export function rememberBarReach(reach: BarReach): void {
  rememberedReach = reach;
}

/** How a reach reads in the picker: a bare number, or the word. */
export function barReachLabel(reach: BarReach): string {
  return reach === "all" ? "All" : String(reach);
}

/**
 * The slice of `ids` a reach exposes, and where the subject sits inside it.
 *
 * CLAMPED RATHER THAN CENTRED. A subject three clips from the start with a
 * reach of ten cannot have ten behind it, and the obvious alternative —
 * shrinking the window to the smaller side — would make the bar change width
 * as you walked towards an end. Taking what is available on the short side and
 * making it up on the long side keeps the window the same size wherever it is,
 * so the scale under the playhead does not shift as you move.
 */
export function barReachWindow(
  ids: readonly string[],
  centre: number,
  reach: BarReach,
): Readonly<{ ids: readonly string[]; centre: number }> {
  if (reach === "all" || centre < 0) return { ids, centre };
  const span = reach * 2 + 1;
  if (ids.length <= span) return { ids, centre };
  const from = Math.min(Math.max(0, centre - reach), ids.length - span);
  return { ids: ids.slice(from, from + span), centre: centre - from };
}
