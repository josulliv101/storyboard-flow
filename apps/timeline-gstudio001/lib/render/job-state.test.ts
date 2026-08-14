import { describe, expect, it } from "vitest";

import { applyRenderEvent, isTerminal, mayReport } from "./job-state";
import type { RenderProgress } from "./types";

const at = (state: RenderProgress["state"], over: Partial<RenderProgress> = {}): RenderProgress => ({
  state,
  ...over,
});

const WORKER = "worker-1";

describe("isTerminal", () => {
  it("is true for the two states nothing may change", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
  });

  it("is false while there is still work to do", () => {
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("claimed")).toBe(false);
    expect(isTerminal("rendering")).toBe(false);
  });
});

describe("mayReport", () => {
  it("admits the holder and nobody else", () => {
    expect(mayReport(WORKER, WORKER)).toBe(true);
    expect(mayReport(WORKER, "worker-2")).toBe(false);
  });

  it("admits nobody when the job is unheld", () => {
    expect(mayReport(null, WORKER)).toBe(false);
  });
});

describe("applyRenderEvent — claiming", () => {
  it("claims a queued job", () => {
    const result = applyRenderEvent(at("queued"), { type: "claim", workerId: WORKER }, null);
    expect(result).toEqual({ ok: true, next: { state: "claimed" } });
  });

  it("REFUSES a second claim — a claim is not a restart", () => {
    // A crashed worker's job stays claimed until something requeues it
    // deliberately; a second claim must not do that silently.
    const result = applyRenderEvent(at("claimed"), { type: "claim", workerId: "worker-2" }, WORKER);
    expect(result).toEqual({ ok: false, reason: "out-of-order" });
  });

  it("refuses to claim work already in flight", () => {
    expect(
      applyRenderEvent(at("rendering"), { type: "claim", workerId: "worker-2" }, WORKER).ok,
    ).toBe(false);
  });
});

describe("applyRenderEvent — reporting", () => {
  it("starts a claimed job at zero", () => {
    const result = applyRenderEvent(at("claimed"), { type: "start" }, WORKER);
    expect(result).toEqual({ ok: true, next: { state: "rendering", fraction: 0 } });
  });

  it("refuses to start a job nobody claimed", () => {
    expect(applyRenderEvent(at("queued"), { type: "start" }, null)).toEqual({
      ok: false,
      reason: "out-of-order",
    });
  });

  it("advances progress and carries the message", () => {
    const result = applyRenderEvent(
      at("rendering", { fraction: 0.2 }),
      { type: "progress", fraction: 0.5, message: "encoding" },
      WORKER,
    );
    expect(result).toEqual({
      ok: true,
      next: { state: "rendering", fraction: 0.5, message: "encoding" },
    });
  });

  it("NEVER GOES BACKWARDS — a slipping bar reads as a stall", () => {
    // ffmpeg's own reporting is not monotonic across stages.
    const result = applyRenderEvent(
      at("rendering", { fraction: 0.8 }),
      { type: "progress", fraction: 0.3 },
      WORKER,
    );
    expect(result).toMatchObject({ ok: true, next: { fraction: 0.8 } });
  });

  it("refuses a fraction outside 0..1", () => {
    for (const fraction of [-0.1, 1.5, Number.NaN]) {
      expect(
        applyRenderEvent(at("rendering"), { type: "progress", fraction }, WORKER),
      ).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("refuses progress before the job started", () => {
    expect(
      applyRenderEvent(at("claimed"), { type: "progress", fraction: 0.5 }, WORKER),
    ).toEqual({ ok: false, reason: "out-of-order" });
  });

  it("succeeds straight from claimed — a fast render never reports progress", () => {
    const result = applyRenderEvent(
      at("claimed"),
      { type: "succeed", outputUrl: "https://cdn.test/out.mp4" },
      WORKER,
    );
    expect(result).toEqual({
      ok: true,
      next: { state: "succeeded", fraction: 1, outputUrl: "https://cdn.test/out.mp4" },
    });
  });

  it("fails from anywhere in flight", () => {
    for (const state of ["claimed", "rendering"] as const) {
      expect(
        applyRenderEvent(at(state), { type: "fail", message: "ffmpeg exited 1" }, WORKER),
      ).toEqual({ ok: true, next: { state: "failed", message: "ffmpeg exited 1" } });
    }
  });
});

describe("applyRenderEvent — terminal is forever", () => {
  it("refuses to move a finished job back into flight", () => {
    const done = at("succeeded", { fraction: 1, outputUrl: "https://cdn.test/out.mp4" });
    expect(applyRenderEvent(done, { type: "start" }, WORKER)).toEqual({
      ok: false,
      reason: "terminal",
    });
    expect(applyRenderEvent(done, { type: "progress", fraction: 0.5 }, WORKER)).toEqual({
      ok: false,
      reason: "terminal",
    });
  });

  it("refuses to turn a success into a failure, or the reverse", () => {
    expect(
      applyRenderEvent(at("succeeded"), { type: "fail", message: "late" }, WORKER).ok,
    ).toBe(false);
    expect(
      applyRenderEvent(at("failed"), { type: "succeed", outputUrl: "x" }, WORKER).ok,
    ).toBe(false);
  });

  it("is IDEMPOTENT for a retried report of the state it is already in", () => {
    // A worker whose report landed but whose response timed out will retry.
    // That is not a fault.
    const done = at("succeeded", { fraction: 1, outputUrl: "https://cdn.test/out.mp4" });
    expect(applyRenderEvent(done, { type: "succeed", outputUrl: "x" }, WORKER)).toEqual({
      ok: true,
      next: done,
    });
    const failed = at("failed", { message: "ffmpeg exited 1" });
    expect(applyRenderEvent(failed, { type: "fail", message: "again" }, WORKER)).toEqual({
      ok: true,
      next: failed,
    });
  });
});

describe("applyRenderEvent — abandoning", () => {
  it("abandons a job nobody has picked up", () => {
    expect(applyRenderEvent(at("queued"), { type: "abandon" }, null)).toEqual({
      ok: true,
      next: { state: "failed", message: "Abandoned before it was claimed." },
    });
  });

  it("REFUSES to abandon work in flight — the worker would render into nothing", () => {
    expect(applyRenderEvent(at("rendering"), { type: "abandon" }, WORKER)).toEqual({
      ok: false,
      reason: "out-of-order",
    });
  });
});
