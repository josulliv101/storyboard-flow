import type { GraphItemAction } from "./graph-view-events";

// How much of the selection pill fits in the card hosting it.
//
// The pill lives INSIDE the anchor card, so its width budget is the card's, and
// this app's cards are not one size: grid cells run 132px at `xs` to 360px at
// `xl`, and a strip clip's width is its DURATION — a 4s clip at default zoom is
// ~200px, a 1s clip is 50px, and the floor is 12px. A full pill needs about
// 250px. So collapsing is not an edge case for tiny windows; it is the common
// case for everything below the largest grid size.
//
// Split out as arithmetic because the thresholds are the part with edges, and a
// function that takes a number and returns a list is far easier to pin than a
// component that takes a ResizeObserver.

/** One control's footprint: a 28px button plus the 4px gap after it. */
const CONTROL_SLOT = 32;

/** A separator plus the gaps either side. Two of them at full width: after the
 *  count group, and before delete (R7.12). */
const SEPARATOR_SLOT = 9;

/** The count group — a check plus a two-digit badge — and its gap. FIXED
 *  regardless of the number showing (R7.6), which is what stops the pill
 *  re-centring as a selection grows. */
const COUNT_SLOT = 38;

/** The pill's own horizontal padding, both sides. */
const PILL_PADDING = 8;

/** The pill's inset from the card's edges, both sides. */
const CARD_INSET = 8;

/** Delete and the overflow, plus the separator fencing delete off. Retained
 *  at every width that renders a full pill (R7.16). */
const ESSENTIALS = CONTROL_SLOT * 2 + SEPARATOR_SLOT;

/**
 * Below this, no pill renders at all (R7.17's floor). Room for the overflow
 * trigger and nothing else — a 12px strip clip has nowhere to put even that,
 * and the header's own overflow is the fallback, which is what it is for.
 */
export const PILL_MINIMUM_WIDTH = CONTROL_SLOT + PILL_PADDING + CARD_INSET * 2;

/** Primary actions in pill order. Delete is not here because it never folds. */
const FOLDABLE: readonly GraphItemAction[] = ["open", "details", "copy", "cut"];

export type PillLayout = Readonly<{
  /** Primary actions to render inline, in order. Anything omitted is still
   *  reachable — the overflow menu always renders the full list. */
  inline: readonly GraphItemAction[];
  /** Whether the count group renders. */
  showCount: boolean;
  /** Whether delete renders inline. False in the collapsed state, where the
   *  pill is the overflow trigger and nothing else. */
  showDelete: boolean;
  /** False when the card cannot host a pill of any kind. */
  visible: boolean;
}>;

const HIDDEN: PillLayout = {
  inline: [],
  showCount: false,
  showDelete: false,
  visible: false,
};

/**
 * Resolve what fits in `cardWidth`.
 *
 * Folds from the RIGHTMOST foldable action (R7.16), so whatever survives keeps
 * the position it had — the actions reached for by muscle memory are at the
 * start of the row, and they must not slide left as the card narrows.
 *
 * Actions are budgeted BEFORE the count group, which is the only ordering that
 * is monotonic. Taking the count out of the budget first meant that shrinking
 * a card could free enough width to ADD an action back — the pill gaining a
 * control as its card got smaller.
 */
export function resolvePillLayout(cardWidth: number): PillLayout {
  if (!Number.isFinite(cardWidth) || cardWidth < PILL_MINIMUM_WIDTH) return HIDDEN;

  const available = cardWidth - CARD_INSET * 2 - PILL_PADDING;
  const forActions = available - ESSENTIALS;
  const fits = Math.min(FOLDABLE.length, Math.max(0, Math.floor(forActions / CONTROL_SLOT)));

  // Nothing but delete would remain, which reads as a broken row rather than a
  // deliberate one. Collapse to the overflow alone instead (R7.17).
  if (fits === 0) {
    return { inline: [], showCount: false, showDelete: false, visible: true };
  }

  // The count is a readout, and the header carries the same number at all
  // times — so it yields to any action that could use the space.
  const leftover = forActions - fits * CONTROL_SLOT;
  return {
    inline: FOLDABLE.slice(0, fits),
    showCount: leftover >= COUNT_SLOT + SEPARATOR_SLOT,
    showDelete: true,
    visible: true,
  };
}
