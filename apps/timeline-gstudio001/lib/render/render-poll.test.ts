import { describe, expect, it } from "vitest";

import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  hasActiveRender,
  nextPollDelayMs,
  renderToShow,
} from "./render-poll";
import type { RenderState } from "./types";

const job = (state: RenderState, createdAt = "2026-08-14T00:00:00Z") => ({
  createdAt,
  progress: { state },
});

describe("hasActiveRender", () => {
  it("is true while anything is queued, claimed or rendering", () => {
    for (const state of ["queued", "claimed", "rendering"] as const) {
      expect(hasActiveRender([state])).toBe(true);
    }
  });

  it("is false once everything has finished, either way", () => {
    expect(hasActiveRender(["succeeded", "failed"])).toBe(false);
  });

  it("is false with nothing to report", () => {
    expect(hasActiveRender([])).toBe(false);
  });

  it("is true if ANY of several is still going", () => {
    expect(hasActiveRender(["succeeded", "failed", "rendering"])).toBe(true);
  });
});

describe("nextPollDelayMs", () => {
  it("STOPS ENTIRELY when the tab is hidden", () => {
    // The one that matters for cost: a tab left open for a day polling in the
    // background is how this runs up a bill quietly.
    expect(nextPollDelayMs({ states: ["rendering"], visible: false })).toBeNull();
    expect(nextPollDelayMs({ states: [], visible: false })).toBeNull();
  });

  it("polls fast while something is actually encoding", () => {
    expect(nextPollDelayMs({ states: ["rendering"], visible: true })).toBe(ACTIVE_POLL_MS);
    expect(nextPollDelayMs({ states: ["queued"], visible: true })).toBe(ACTIVE_POLL_MS);
  });

  it("backs off when nothing is running", () => {
    expect(nextPollDelayMs({ states: ["succeeded"], visible: true })).toBe(IDLE_POLL_MS);
    expect(nextPollDelayMs({ states: [], visible: true })).toBe(IDLE_POLL_MS);
  });

  it("keeps the idle rate an order of magnitude slower than the active one", () => {
    // Pinned as a relationship rather than two numbers: tuning one without the
    // other is what turns an idle board into a busy one.
    expect(IDLE_POLL_MS).toBeGreaterThanOrEqual(ACTIVE_POLL_MS * 10);
  });
});

describe("renderToShow", () => {
  it("is null when there are none", () => {
    expect(renderToShow([])).toBeNull();
  });

  it("speaks for the ACTIVE render even when a newer one has finished", () => {
    // "Rendering 40%" is a fact about now; a finished render has a card in the
    // Renders collection, where the in-flight one has only this chip.
    const newest = job("succeeded", "2026-08-14T03:00:00Z");
    const active = job("rendering", "2026-08-14T01:00:00Z");
    expect(renderToShow([newest, active])).toBe(active);
  });

  it("otherwise speaks for the newest", () => {
    const newest = job("succeeded", "2026-08-14T03:00:00Z");
    const older = job("failed", "2026-08-14T01:00:00Z");
    expect(renderToShow([newest, older])).toBe(newest);
  });

  it("prefers the FIRST active one when several are running", () => {
    const a = job("rendering", "2026-08-14T03:00:00Z");
    const b = job("queued", "2026-08-14T02:00:00Z");
    expect(renderToShow([a, b])).toBe(a);
  });
});
