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

/**
 * THE PICTURE INSIDE A BOARD CARD — what actually flies (PL15-034).
 *
 * The name used to go on the whole card, and the flight was measured doing
 * this: a 298x220 grid card tweening into a 326x363 deck card, a 65% vertical
 * stretch, while the browser cross-faded a grid card's contents (one picture,
 * one caption row) against a deck card's (header, title, picture, scrub bar,
 * in/out row, tags). Nothing inside either box corresponded to anything in the
 * other, so the middle of the flight was two unrelated layouts on top of each
 * other — the ghosting in the recording.
 *
 * The pictures, measured at the same moment, are 286x154 and 296x148. Morphing
 * THOSE is a +3.5% / -3.9% box change: a translation with a cross-fade between
 * two renderings of the same frame, which is the "one picture moving" the
 * flight is supposed to say.
 *
 * `[data-clip-artwork]` is already the board's own name for that box — the grid
 * play buttons measure it to find where the picture ends inside a cell — and
 * both card kinds carry it. Falls back to the card so a kind that grows without
 * one still flies rather than cutting.
 */
export function heroElement(id: string): HTMLElement | null {
  const card = cardElement(id);
  return card?.querySelector<HTMLElement>("[data-clip-artwork]") ?? card;
}

/**
 * WHERE THE BOARD WAS SCROLLED TO — two sources, and the gesture wins
 * (PL15-033, finally closed).
 *
 * The board scrolls the DOCUMENT, and hiding it collapses the page, so the
 * browser clamps the window offset to 0. Carrying it across is
 * `GraphBoardContent`'s job and it does so by parking every scroll while the
 * board is showing.
 *
 * THAT ALONE IS A RACE, and it was seen in the wild once before it could be
 * named. Hiding the board is the same commit that makes the browser clamp, and
 * a clamp emits a scroll event; React's passive cleanup runs after paint. If
 * the event beats the teardown the listener parks the clamped 0, the restore
 * declines, and the grid comes back at the top. Nothing orders those two.
 *
 * So the OPEN GESTURE takes its own reading, synchronously, before React has
 * rendered anything and therefore before anything can have clamped. That value
 * cannot be wrong. The listener's is kept as the fallback for the ways in that
 * are not a gesture — a deep link, Back/Forward — where there was no board on
 * screen to read and 0 is the right answer anyway.
 *
 * Two slots rather than a lock, deliberately: a lock has to be released, and
 * the release would be another ordering question between two components'
 * effects. A value that simply outranks the other has none.
 */
let parkedBoardScroll = 0;
let boardScrollAtOpen: number | null = null;

/** From `GraphBoardContent`'s listener, while the board is showing. */
export function parkBoardScroll(y: number): void {
  parkedBoardScroll = y;
}

/** From the open gesture, before the board can be hidden out from under it. */
export function captureBoardScrollAtOpen(y: number): void {
  boardScrollAtOpen = y;
}

/**
 * Puts the board back, and is called INSIDE the closing transition's callback
 * (PL15-035): after the browser has captured the frame the details view is
 * still in, so moving the page cannot displace what the morph flies from, and
 * before it captures the frame the board is in, so the card is already where it
 * belongs.
 */
export function restoreBoardScroll(): void {
  const to = boardScrollAtOpen ?? parkedBoardScroll;
  boardScrollAtOpen = null;
  if (to === 0) return;
  // TWICE, AND THE SECOND ONE IS THE ONE THAT LANDS. Closing by Back is a
  // popstate, and the browser restores that entry's own offset after this runs
  // — recorded while the page was short, so it is 0 and it overwrites this. A
  // frame later nothing else is going to move it.
  window.scrollTo(0, to);
  requestAnimationFrame(() => window.scrollTo(0, to));
}
