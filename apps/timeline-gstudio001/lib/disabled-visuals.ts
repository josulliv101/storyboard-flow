/**
 * How hard to suppress a card that will not play.
 *
 * A card is "off" for two different reasons, and they are not the same
 * statement:
 *
 *   SELF — the user switched this item off. It is one item among siblings that
 *   are on, and the whole job of the dimming is to separate it from them.
 *
 *   INHERITED — an ancestor collection is off, so this item cannot play
 *   either. Nothing was decided about THIS item.
 *
 * They used to render identically, which is wrong in the case that matters
 * most: drill into a disabled collection and EVERY card on screen is inherited
 * -off. Uniform heavy dimming then distinguishes nothing — there is no
 * undimmed sibling to contrast against — and all it achieves is making the
 * content you came in to look at hard to see. The "this is off" message is
 * already carried by the chip on each card and by the breadcrumb you walked
 * through to get here.
 *
 * So inherited stays LEGIBLE: a light knock-back that reads as secondary, with
 * no grayscale. Self keeps the heavy treatment, because there it is doing real
 * work against its neighbours.
 *
 * Pure and in a `.ts` file: the app's vitest cannot parse `.tsx`, and both
 * card kinds (media and collection) must apply exactly the same mapping — a
 * drift between the two is precisely the bug this module exists to prevent.
 */

export type DisabledVisualState = "none" | "inherited" | "self";

export function disabledVisualState(
  input: Readonly<{ selfDisabled: boolean; inheritedDisabled: boolean }>,
): DisabledVisualState {
  // SELF WINS. An explicitly disabled card inside an already-disabled
  // collection is still an explicit choice, and switching the ancestor back on
  // must leave this one off — so it has to keep reading as self-disabled while
  // both are true.
  if (input.selfDisabled) return "self";
  if (input.inheritedDisabled) return "inherited";
  return "none";
}

/*
 * THE CLASS NAMES LIVE IN THE COMPONENT, not here, and that is not a style
 * preference — Tailwind would not generate them from this file.
 *
 * `app/globals.css` scans `../app`, `../components` and `packages/ui`. It does
 * NOT scan `../lib`. A class written here is therefore never emitted, and the
 * failure is silent in exactly the worst way: the attribute is right, the
 * markup is right, and the pixels are simply unstyled. It cost a story failure
 * to find, and it would have shipped looking like the bug it was meant to fix.
 *
 * The two card kinds used to live in one component file, so a module-level
 * constant there covered the "these two must not drift" concern. They are two
 * files now (#281), which makes the classes a shared module of their own:
 * `components/graph-view/graph-card-dimming`, still inside the scanned tree.
 * The PRECEDENCE that picks between them is pure and unit-tested in
 * `graph-card-model`.
 */

/**
 * The DOM value for `data-disabled-visuals`.
 *
 * `"true"` rather than `"self"` for the self case, matching the `data-disabled`
 * attribute beside it — which has spelled this pair `"true"` / `"inherited"`
 * since before the visuals diverged. One vocabulary for one concept; the e2e
 * already selects on `[data-disabled-visuals="true"]`.
 */
export function disabledVisualsAttr(state: DisabledVisualState): string | undefined {
  if (state === "none") return undefined;
  return state === "self" ? "true" : "inherited";
}
