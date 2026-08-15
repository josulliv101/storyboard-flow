import { describe, expect, it } from "vitest";

import {
  DEFAULT_RENDER_FORMAT,
  RENDER_FORMAT_PRESETS,
  renderFormatOf,
  renderFormatPresetOf,
  sameRenderFormat,
} from "./render-format";

describe("DEFAULT_RENDER_FORMAT", () => {
  it("is 16:9", () => {
    // A DELIVERABLE decision, not a description of the sources — this
    // project's material is mostly ~2.35:1. A project that wants something
    // else stores its own.
    expect(DEFAULT_RENDER_FORMAT.width / DEFAULT_RENDER_FORMAT.height).toBeCloseTo(16 / 9, 6);
  });

  it("is even in both dimensions, or nothing renders", () => {
    // libx264 refuses an odd width or height in yuv420p outright.
    expect(DEFAULT_RENDER_FORMAT.width % 2).toBe(0);
    expect(DEFAULT_RENDER_FORMAT.height % 2).toBe(0);
  });

  it("is one of the presets, so the board can name it", () => {
    expect(renderFormatPresetOf(DEFAULT_RENDER_FORMAT)).toBeDefined();
  });
});

describe("RENDER_FORMAT_PRESETS", () => {
  it("are all even-dimensioned and encodable", () => {
    for (const preset of RENDER_FORMAT_PRESETS) {
      expect(renderFormatOf(preset.format)).toEqual(preset.format);
    }
  });

  it("keeps the SCOPE size this project's shots come out at", () => {
    // 1152x480 is the verified MiniMax H3 output size, and what every render
    // before the setting existed used. Losing it would strand that material.
    expect(RENDER_FORMAT_PRESETS.map((p) => `${p.format.width}x${p.format.height}`)).toContain(
      "1152x480",
    );
  });

  it("has distinct ids", () => {
    const ids = RENDER_FORMAT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("renderFormatOf", () => {
  it("takes a real format", () => {
    expect(renderFormatOf({ width: 1280, height: 720, fps: 24 })).toEqual({
      width: 1280,
      height: 720,
      fps: 24,
    });
  });

  it("REFUSES AN ODD DIMENSION, which cannot be encoded", () => {
    // Storing one would produce a project that simply fails to render, and
    // the failure would surface as an opaque ffmpeg error minutes later.
    expect(renderFormatOf({ width: 1281, height: 720, fps: 24 })).toBeUndefined();
    expect(renderFormatOf({ width: 1280, height: 721, fps: 24 })).toBeUndefined();
  });

  it("drops anything that is not a usable format", () => {
    for (const bad of [
      undefined,
      null,
      "1280x720",
      { width: 1280, height: 720 },
      { width: 0, height: 720, fps: 24 },
      { width: -1280, height: 720, fps: 24 },
      { width: 1280.5, height: 720, fps: 24 },
      { width: Number.NaN, height: 720, fps: 24 },
      { width: 1280, height: 720, fps: 0 },
      { width: 1280, height: 720, fps: 1000 },
      { width: 99999, height: 720, fps: 24 },
    ]) {
      expect(renderFormatOf(bad)).toBeUndefined();
    }
  });

  it("keeps only the three fields", () => {
    expect(renderFormatOf({ width: 1280, height: 720, fps: 24, bitrate: 9000 })).toEqual({
      width: 1280,
      height: 720,
      fps: 24,
    });
  });

  it("allows an ODD fps — 25 and 30 are ordinary", () => {
    expect(renderFormatOf({ width: 1280, height: 720, fps: 25 })?.fps).toBe(25);
  });
});

describe("sameRenderFormat", () => {
  it("compares by value", () => {
    const a = { width: 1280, height: 720, fps: 24 };
    expect(sameRenderFormat(a, { ...a })).toBe(true);
    expect(sameRenderFormat(a, { ...a, fps: 30 })).toBe(false);
  });
});
