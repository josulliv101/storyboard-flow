// The few values the carousel and one panel both need. Kept apart from either
// so neither has to import the other just to agree on a name or a size.

/** The one name shared by the card and the modal's frame. Only ONE element
 *  may carry it at a time — two would make the browser skip the morph — so it
 *  is handed over inside the transition callback, never held by both. */
export const HERO = "trim-subject";

/**
 * How an element is given `HERO`, on BOTH flights.
 *
 * Not an inline style, which is what this used to be. React manages the
 * `style` attribute of anything it renders and rewrites it on any re-render —
 * and both flights have one landing in the window between the call and the
 * browser's capture, because both hand the name to a card React is rendering
 * at that moment. The name was gone by the time the browser looked, so the
 * morph had one end and rendered as a fade.
 *
 * React does not reconcile an attribute it was never given. The rule that
 * turns this into `view-transition-name: trim-subject` lives in `globals.css`.
 */
export const HERO_ATTRIBUTE = "data-details-hero";

/** The gap between panels in the row; also part of the width arithmetic. */
export const PANEL_GAP = "1rem";

/**
 * How wide the monitor should be while someone is scrubbing.
 *
 * Enough to judge a cut on, which is the whole reason for dragging the bar,
 * and short of "fills the screen" — the neighbours either side are still the
 * context that makes the frame mean something.
 */
export const MONITOR_TARGET_PX = 620;

/** Beyond this a magnified panel is soft rather than large: everything in it
 *  is scaled type and scaled borders. */
export const MAX_MAGNIFICATION = 2.2;

export function cardElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
}
