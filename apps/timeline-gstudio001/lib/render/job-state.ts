// The render job's STATE MACHINE — pure, so the rules that decide whether a
// worker's report is legal unit-test without Firestore.
//
// It exists because the worker is a separate process the app does not control.
// It can crash mid-render and come back, report out of order, or report
// against a job someone else already took. Every one of those arrives as an
// ordinary HTTP request, so "is this transition legal" has to be a decision
// the server makes rather than something the client is trusted about.

import type { RenderProgress, RenderState } from "./types";

/** What can happen to a job. `claim` is the worker taking it; the rest are it
 *  reporting. There is no `queue` — that is creation. */
export type RenderEvent =
  | Readonly<{ type: "claim"; workerId: string }>
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "progress"; fraction: number; message?: string }>
  | Readonly<{ type: "succeed"; outputUrl: string }>
  | Readonly<{ type: "fail"; message: string }>
  /** The app abandoning a job that has not been picked up. */
  | Readonly<{ type: "abandon" }>;

export type RenderTransition =
  | Readonly<{ ok: true; next: RenderProgress }>
  | Readonly<{ ok: false; reason: RenderTransitionError }>;

export type RenderTransitionError =
  /** The job has already finished; nothing may change it. */
  | "terminal"
  /** Legal event, wrong moment (progress before claim, start before claim). */
  | "out-of-order"
  /** Someone else holds this job. */
  | "not-holder"
  /** The event itself is malformed — a fraction outside 0..1. */
  | "invalid";

const TERMINAL: ReadonlySet<RenderState> = new Set<RenderState>(["succeeded", "failed"]);

export function isTerminal(state: RenderState): boolean {
  return TERMINAL.has(state);
}

/**
 * Apply one event to a job's current progress.
 *
 * THREE rules carry the weight, and each exists because of a way a detached
 * worker actually fails:
 *
 * TERMINAL IS FOREVER. A worker that finished, then retried its report after a
 * network timeout, must not move a succeeded job back to `rendering` — the app
 * has already shown the output and may have filed it. Re-reporting the SAME
 * terminal state is idempotent rather than an error, because a retry of a
 * report that did land is not a fault.
 *
 * ONLY THE HOLDER MAY REPORT. `claim` records a `workerId`, and everything
 * after it checks that id. Without this, a second worker (a stale process, or
 * the same machine restarted) reports over a render it is not doing, and the
 * output URL that lands belongs to whichever finished last.
 *
 * A CLAIM IS NOT A RESTART. Only a `queued` job can be claimed. A crashed
 * worker's job stays `claimed` until something requeues it deliberately —
 * which is a decision with a timeout attached, not something a second claim
 * should perform silently.
 */
export function applyRenderEvent(
  current: RenderProgress,
  event: RenderEvent,
  holderWorkerId: string | null,
): RenderTransition {
  if (isTerminal(current.state)) {
    // Idempotent re-report of the state we are already in.
    if (event.type === "succeed" && current.state === "succeeded") {
      return { ok: true, next: current };
    }
    if (event.type === "fail" && current.state === "failed") {
      return { ok: true, next: current };
    }
    return { ok: false, reason: "terminal" };
  }

  if (event.type === "claim") {
    if (current.state !== "queued") return { ok: false, reason: "out-of-order" };
    return { ok: true, next: { state: "claimed" } };
  }

  if (event.type === "abandon") {
    // Only before anyone picks it up. Once claimed, abandoning would leave a
    // worker rendering into a job that no longer expects it.
    if (current.state !== "queued") return { ok: false, reason: "out-of-order" };
    return { ok: true, next: { state: "failed", message: "Abandoned before it was claimed." } };
  }

  // Everything below is the holder reporting on work it took.
  if (holderWorkerId === null) return { ok: false, reason: "out-of-order" };

  switch (event.type) {
    case "start":
      if (current.state !== "claimed") return { ok: false, reason: "out-of-order" };
      return { ok: true, next: { state: "rendering", fraction: 0 } };

    case "progress": {
      if (current.state !== "rendering") return { ok: false, reason: "out-of-order" };
      if (!(event.fraction >= 0 && event.fraction <= 1)) {
        return { ok: false, reason: "invalid" };
      }
      // NEVER GOES BACKWARDS. Progress is what a human reads to decide whether
      // to keep waiting, and ffmpeg's own reporting is not monotonic across
      // stages — a bar that slips back reads as a stall or a restart.
      const fraction = Math.max(current.fraction ?? 0, event.fraction);
      return {
        ok: true,
        next: {
          state: "rendering",
          fraction,
          ...(event.message === undefined ? {} : { message: event.message }),
        },
      };
    }

    case "succeed":
      // From `claimed` too, not only `rendering`: a worker that renders fast
      // enough never sends a progress report, and refusing its result would
      // fail the one render that went perfectly.
      return { ok: true, next: { state: "succeeded", fraction: 1, outputUrl: event.outputUrl } };

    case "fail":
      return { ok: true, next: { state: "failed", message: event.message } };
  }
}

/**
 * Whether `workerId` may report on a job held by `holderWorkerId`.
 *
 * Separate from the transition so the store can reject an impostor BEFORE
 * reading the rest of the request, and so the rule is stated once for every
 * reporting event rather than repeated per case.
 */
export function mayReport(holderWorkerId: string | null, workerId: string): boolean {
  return holderWorkerId !== null && holderWorkerId === workerId;
}
