import { isTerminal } from "./job-state";
import type { RenderState } from "./types";

/**
 * How often the board asks the server about renders.
 *
 * This is a COST decision as much as a UX one. The render is started from
 * somewhere else entirely (an MCP tool, an agent), so the board cannot know a
 * render exists without asking — and every ask is a Firestore read that runs
 * for as long as a tab is open. A flat interval fast enough to feel live would
 * be thousands of reads a day per tab, for a project that renders a handful of
 * times.
 *
 * So the rate follows what is actually happening:
 *
 *   ACTIVE — something is queued or encoding, and the number on screen is
 *   changing. Worth a read every few seconds, and it is bounded by the render.
 *
 *   IDLE — nothing is running. The only thing a poll can discover is a render
 *   someone just started elsewhere, and being a few seconds late to notice
 *   that costs nothing.
 *
 *   HIDDEN — the tab is in the background. Nobody is reading the number, so
 *   the right rate is none at all. This is the one that matters most: a tab
 *   left open for a day is the shape that runs up a bill quietly.
 */
export const ACTIVE_POLL_MS = 2500;
export const IDLE_POLL_MS = 30_000;

export type PollInput = Readonly<{
  /** Every render state the board currently knows about for this timeline. */
  states: readonly RenderState[];
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
}>;

/** Whether any known render is still going. */
export function hasActiveRender(states: readonly RenderState[]): boolean {
  return states.some((state) => !isTerminal(state));
}

/**
 * The next poll delay in milliseconds, or null to STOP POLLING ENTIRELY.
 *
 * Null rather than "a very long interval": a hidden tab should schedule
 * nothing at all, so the work resumes on the visibility change rather than
 * limping along in the background.
 */
export function nextPollDelayMs(input: PollInput): number | null {
  if (!input.visible) return null;
  return hasActiveRender(input.states) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

/**
 * Which render the chip should speak for, given the newest-first list.
 *
 * AN ACTIVE ONE ALWAYS WINS, even if a newer render has already finished.
 * "Rendering 40%" is a fact about right now; "Render ready" is a fact about
 * the past, and a finished render has a durable home — a card in the Renders
 * collection — where the in-flight one has nothing but this chip.
 *
 * Otherwise the newest, so a just-finished render can say so.
 */
export function renderToShow<T extends { progress: { state: RenderState } }>(
  newestFirst: readonly T[],
): T | null {
  const active = newestFirst.find((job) => !isTerminal(job.progress.state));
  return active ?? newestFirst[0] ?? null;
}
