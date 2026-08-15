import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYER_POSITION,
  DEFAULT_LAYER_SIZE,
  layerFrameForPreset,
  layerFrameHeight,
  layerFrameOf,
  layerFrameRect,
  sameLayerFrame,
} from "./layer-frame";

// The shipping output format is 1152x480 — a 2.4:1 frame, which is wide enough
// that anything treating the two axes as interchangeable shows up immediately.
const FRAME = 1152 / 480;
const WIDESCREEN = 16 / 9;

describe("layerFrameHeight", () => {
  it("keeps a 16:9 clip undistorted in a 2.4:1 frame", () => {
    // 0.3 of 1152 = 345.6px wide; 16:9 makes that 194.4px tall; over 480 that
    // is 0.405 of the frame's height.
    expect(layerFrameHeight(0.3, WIDESCREEN, FRAME)).toBeCloseTo(0.405, 4);
  });

  it("is TALLER than it is wide in normalized units, for a wide frame", () => {
    // The trap this exists to avoid: treating width and height as the same
    // unit. In a 2.4:1 frame a 16:9 inset covers a bigger fraction of the
    // height than of the width, and drawing it as a square fraction squashes
    // it — invisible in a story fixture, obvious in a render.
    expect(layerFrameHeight(0.3, WIDESCREEN, FRAME)).toBeGreaterThan(0.3);
  });

  it("is the same fraction on both axes when the frame matches the clip", () => {
    expect(layerFrameHeight(0.3, WIDESCREEN, WIDESCREEN)).toBeCloseTo(0.3, 6);
  });

  it("treats a nonsense aspect as square rather than dividing by zero", () => {
    expect(Number.isFinite(layerFrameHeight(0.3, 0, FRAME))).toBe(true);
  });
});

describe("layerFrameForPreset", () => {
  it("puts the default inset in the bottom-right, inside the frame", () => {
    const frame = layerFrameForPreset(
      DEFAULT_LAYER_POSITION,
      DEFAULT_LAYER_SIZE,
      WIDESCREEN,
      FRAME,
    );
    const rect = layerFrameRect(frame, WIDESCREEN, FRAME);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    // Past the middle on both axes — that is what "bottom-right" has to mean.
    expect(rect.x).toBeGreaterThan(0.5);
    expect(rect.y).toBeGreaterThan(0.5);
  });

  it("uses an EVEN margin in pixels, not in normalized units", () => {
    // The reason MARGIN is scaled by the frame aspect. Left gap and bottom gap
    // must be the same number of PIXELS; comparing the raw normalized values
    // would have them differ by 2.4x and look wrong on screen.
    const frame = layerFrameForPreset("bottom-left", "medium", WIDESCREEN, FRAME);
    const rect = layerFrameRect(frame, WIDESCREEN, FRAME);
    const leftPx = rect.x * 1152;
    const bottomPx = (1 - (rect.y + rect.height)) * 480;
    expect(Math.abs(leftPx - bottomPx)).toBeLessThanOrEqual(0.5);
  });

  it("centres on both axes for the middle position", () => {
    const frame = layerFrameForPreset("center", "small", WIDESCREEN, FRAME);
    const rect = layerFrameRect(frame, WIDESCREEN, FRAME);
    expect(rect.x + rect.width / 2).toBeCloseTo(0.5, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo(0.5, 6);
  });

  it("orders the three sizes, and keeps them all inside the frame", () => {
    const widths = (["small", "medium", "large"] as const).map(
      (size) => layerFrameForPreset("top-left", size, WIDESCREEN, FRAME).width,
    );
    expect(widths[0]).toBeLessThan(widths[1]);
    expect(widths[1]).toBeLessThan(widths[2]);
    for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const rect = layerFrameRect(
        layerFrameForPreset(position, "large", WIDESCREEN, FRAME),
        WIDESCREEN,
        FRAME,
      );
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("still fits a TALL clip, which a large preset would otherwise overflow", () => {
    // A 9:16 clip at 45% width is far taller than the frame in a 2.4:1 output.
    // Clamped rather than allowed to hang off the top and bottom.
    const rect = layerFrameRect(
      layerFrameForPreset("bottom-right", "large", 9 / 16, FRAME),
      9 / 16,
      FRAME,
    );
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("layerFrameRect", () => {
  it("nudges a stored frame back inside a frame it no longer fits", () => {
    // A rectangle written at one output size, rendered at another. Cropping the
    // picture would be the worse answer.
    const rect = layerFrameRect({ x: 0.95, y: 0.95, width: 0.3 }, WIDESCREEN, FRAME);
    expect(rect.x + rect.width).toBeCloseTo(1, 6);
    expect(rect.y + rect.height).toBeCloseTo(1, 6);
  });
});

describe("layerFrameOf", () => {
  it("takes a real rectangle", () => {
    expect(layerFrameOf({ x: 0.6, y: 0.5, width: 0.3 })).toEqual({ x: 0.6, y: 0.5, width: 0.3 });
  });

  it("drops anything that is not one, so a bad value means NO PICTURE", () => {
    // Honoured, not derived: a value that cannot be trusted has to fall back to
    // the safe default rather than put a layer somewhere nobody asked for.
    for (const bad of [
      undefined,
      null,
      "0.5",
      42,
      {},
      { x: 0.5, y: 0.5 },
      { x: Number.NaN, y: 0.5, width: 0.3 },
      { x: -0.1, y: 0.5, width: 0.3 },
      { x: 1.4, y: 0.5, width: 0.3 },
      { x: 0.5, y: 0.5, width: 0 },
      { x: 0.5, y: 0.5, width: -0.3 },
      { x: 0.5, y: 0.5, width: 1.2 },
    ]) {
      expect(layerFrameOf(bad)).toBeUndefined();
    }
  });

  it("keeps only the three fields, so a fattened stored value cannot leak", () => {
    expect(layerFrameOf({ x: 0.1, y: 0.2, width: 0.3, height: 0.9, junk: true })).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.3,
    });
  });
});

describe("sameLayerFrame", () => {
  it("compares by VALUE — the whole reason it exists", () => {
    // The graph's placement command decides "did this change" with ===, which
    // for two identical objects is false. Without this, every dispatch would
    // look like a change and put a no-op entry in undo history.
    expect(sameLayerFrame({ x: 0.1, y: 0.2, width: 0.3 }, { x: 0.1, y: 0.2, width: 0.3 })).toBe(
      true,
    );
    expect(sameLayerFrame({ x: 0.1, y: 0.2, width: 0.3 }, { x: 0.1, y: 0.2, width: 0.4 })).toBe(
      false,
    );
  });

  it("treats absent as a value of its own", () => {
    expect(sameLayerFrame(undefined, undefined)).toBe(true);
    expect(sameLayerFrame(undefined, { x: 0.1, y: 0.2, width: 0.3 })).toBe(false);
    expect(sameLayerFrame({ x: 0.1, y: 0.2, width: 0.3 }, undefined)).toBe(false);
  });
});
