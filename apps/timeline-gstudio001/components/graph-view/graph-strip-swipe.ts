// WHEN A DRAG ACROSS THE FILM STRIP MEANS "GO", and which way.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse it.
// Every interesting case here is a judgement call about a gesture — a flick
// that barely moved, a drag that changed its mind, a pull against the end of
// the timeline — and none of it needs a DOM to be wrong in.

/** Which neighbour a completed gesture asked for, or null to stay put. */
export type SwipeIntent = "previous" | "next" | null;

export type SwipeReading = Readonly<{
  /** Horizontal travel, positive when dragged RIGHT. */
  dx: number;
  /** Vertical travel, either sign. */
  dy: number;
  /** How long the gesture took. */
  elapsedMs: number;
  /** One panel's width, so the distance rule scales with the layout. */
  panelWidth: number;
  /** Whether there is anything to move to in each direction. */
  hasPrevious: boolean;
  hasNext: boolean;
}>;

/** Below this, a gesture is a tap or a tremor rather than a swipe. */
const MIN_TRAVEL_PX = 24;
/** A committing drag: this share of a panel, with a floor for small screens. */
const COMMIT_SHARE = 0.18;
const MIN_COMMIT_PX = 56;
/** A flick: fast enough that distance stops being the question. */
const FLICK_PX_PER_MS = 0.5;

/**
 * Read a finished drag.
 *
 * MOSTLY-VERTICAL GESTURES ARE NOT SWIPES, checked first and independently of
 * how far the finger went sideways. A thumb travelling down a phone screen
 * covers real horizontal distance on the way, and without this every scroll
 * that started on a picture would fling the strip to another clip.
 *
 * DISTANCE OR SPEED, either one. A slow, deliberate pull past a fifth of a
 * panel is obviously a swipe; so is a quick flick that never got that far,
 * which is what a gesture on a phone usually is. Requiring both would mean the
 * flick — the one people actually make — did nothing.
 *
 * SCALED TO THE PANEL rather than fixed, because the same 80px is a decisive
 * shove on a phone and a twitch on a wide monitor. The floor keeps the small
 * end from committing on a wobble.
 *
 * A PULL AGAINST THE END OF THE TIMELINE IS NULL, not a silent no-op — the
 * caller uses the same answer to decide whether to resist the drag while it is
 * happening, so the edge behaves consistently in the hand and on release.
 */
export function swipeIntent(reading: SwipeReading): SwipeIntent {
  const { dx, dy, elapsedMs, panelWidth, hasPrevious, hasNext } = reading;
  const travel = Math.abs(dx);
  if (travel < MIN_TRAVEL_PX) return null;
  if (Math.abs(dy) >= travel) return null;

  const commitAt = Math.max(MIN_COMMIT_PX, panelWidth * COMMIT_SHARE);
  const speed = elapsedMs > 0 ? travel / elapsedMs : Number.POSITIVE_INFINITY;
  if (travel < commitAt && speed < FLICK_PX_PER_MS) return null;

  // Dragged LEFT pulls the strip forward — the film moves the way the hand
  // moves, so the next clip arrives from the right.
  const wanted: SwipeIntent = dx < 0 ? "next" : "previous";
  if (wanted === "next" && !hasNext) return null;
  if (wanted === "previous" && !hasPrevious) return null;
  return wanted;
}

/**
 * How far the row should actually move for a drag of `dx`, live.
 *
 * RESISTED AT THE ENDS rather than blocked. Dragging toward nothing still
 * moves, by a third, which is the difference between "there is nothing there"
 * and "this control is broken" — a strip that refuses to budge reads as a
 * dropped gesture, and the same pull on a middle clip moves freely.
 */
export function swipeOffset(
  dx: number,
  hasPrevious: boolean,
  hasNext: boolean,
): number {
  const pullingToNext = dx < 0;
  const blocked = pullingToNext ? !hasNext : !hasPrevious;
  return blocked ? dx / 3 : dx;
}
