"use client";

import { cardDimming, type CardKnockBack } from "./graph-card-model";
import type { DisabledVisualState } from "@/lib/disabled-visuals";

/**
 * How hard each cause knocks a card back, as CLASSES.
 *
 * The classes are in `components/` and not in `lib/` because Tailwind's content
 * scan covers `app`, `components` and `packages/ui` — and NOT `lib`. A class
 * name written over there is never generated, and it fails silently in the
 * worst way: the attribute is right, the markup is right, and the pixels are
 * simply unstyled.
 *
 * The two card kinds used to hold matching copies of this ladder, each under a
 * comment claiming it was shared. Splitting them into separate files (#281)
 * made that untrue in the obvious way as well as the real one, so the mapping
 * moved here and both kinds call `cardDimmingClass`.
 *
 * SELF is heavy (45% + grayscale): that card sits among siblings that are on,
 * and separating it from them is the whole job. INHERITED is light (75%, no
 * grayscale): drill into a disabled collection and EVERY card is inherited-off,
 * so heavy uniform dimming has nothing to contrast against and only costs the
 * legibility of what you came in to look at.
 *
 * A FILTER MISS is its own state, with opacity only — `opacity-45 grayscale` is
 * already disabled's language, and a card that is both must still read as both.
 */
const KNOCK_BACK_CLASS: Readonly<Record<CardKnockBack, string>> = {
  none: "",
  "drag-source": "opacity-40",
  self: "opacity-45",
  inherited: "opacity-75",
  "filter-miss": "opacity-30",
};

/** Written as a WHOLE literal class name — Tailwind's JIT scans source text, so
 *  an interpolated one is a class that never gets generated. */
const GRAYSCALE_CLASS = "grayscale";

/**
 * The dimming classes for one card, opacity and filter together.
 *
 * Returns a single space-joined string including the shared transition, so both
 * card kinds get identical pixels from identical inputs. The PRECEDENCE is
 * decided in `graph-card-model.cardDimming`, which is unit-tested; this owns
 * only the class names it cannot be tested with.
 */
export function cardDimmingClass(
  input: Readonly<{
    isDragSource: boolean;
    disabledVisuals: DisabledVisualState;
    filterMiss: boolean;
  }>,
): string {
  const { knockBack, grayscale } = cardDimming(input);
  return [
    KNOCK_BACK_CLASS[knockBack],
    grayscale ? GRAYSCALE_CLASS : "",
    "motion-safe:transition-opacity motion-safe:duration-150",
  ]
    .filter(Boolean)
    .join(" ");
}
