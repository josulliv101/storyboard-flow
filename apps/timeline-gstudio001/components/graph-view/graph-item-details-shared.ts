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
 * WHERE THE BOARD WAS SCROLLED TO, across a trip through the details view
 * (PL15-033).
 *
 * The board grid scrolls the DOCUMENT — `main` is `flex-1` inside a
 * `min-h-screen` shell, and PL15-032's note says the board and the grid both
 * legitimately scroll the page. The details view then sizes itself to exactly
 * `innerHeight - top - gap`, so while it is open the document is precisely the
 * window and there is nothing left to scroll.
 *
 * The browser does not remember an offset it can no longer honour: it CLAMPS.
 * Measured at a 560px window with 291px of grid scroll — open the view and
 * `scrollHeight` goes 851 -> 560, `scrollY` goes 291 -> 0. The position is
 * destroyed on the way IN, silently, because the board is not on screen to
 * show it. Closing then puts the grid back at the top, which is the jump.
 *
 * It costs the closing flight too: the card that was clicked at y=76 lands at
 * y=367 — 291px down, exactly the lost scroll — so the picture flies home to
 * somewhere the card is not.
 *
 * Module state rather than React state on purpose. Two files own the two ends
 * of this (the context opens, the view closes) and the value must survive the
 * unmount BETWEEN them, which is the one thing component state cannot do.
 */
let boardScrollY: number | null = null;

/** Called on the way in, from the board, before the document can collapse. */
export function rememberBoardScroll(): void {
  if (typeof window === "undefined") return;
  boardScrollY = window.scrollY;
}

/**
 * Called on the way out, inside the closing transition's callback — after the
 * board is back in the DOM and before the browser captures the "after" frame,
 * so the card the picture is flying to is already at its restored position.
 *
 * CONSUMED, not just read: a deep link into the view has nothing to restore,
 * and a stale offset from an earlier visit would be worse than none.
 */
export function restoreBoardScroll(): void {
  if (boardScrollY === null || typeof window === "undefined") return;
  const y = boardScrollY;
  boardScrollY = null;
  window.scrollTo(0, y);
}
