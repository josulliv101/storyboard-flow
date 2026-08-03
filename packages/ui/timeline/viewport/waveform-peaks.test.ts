import { describe, expect, it } from "vitest";

import {
  bucketCountFor,
  computePeaks,
  peakMagnitude,
  peaksForWindow,
  PEAK_BUCKETS_PER_SECOND,
} from "./waveform-peaks";

/** Read one bucket's [min, max] out of the interleaved array. */
function bucket(values: Float32Array, index: number): [number, number] {
  return [values[index * 2], values[index * 2 + 1]];
}

/** Compare a bucket with tolerance: these are Float32Array cells, so a literal
 *  like -0.4 reads back as -0.4000000059604645 and exact equality is a trap. */
function expectBucket(values: Float32Array, index: number, min: number, max: number) {
  const [actualMin, actualMax] = bucket(values, index);
  expect(actualMin).toBeCloseTo(min, 5);
  expect(actualMax).toBeCloseTo(max, 5);
}

describe("computePeaks", () => {
  it("keeps min AND max, so an asymmetric signal stays asymmetric", () => {
    // A waveform drawn from absolute values would report these identically.
    const peaks = computePeaks([-0.2, 0.9], 1, 1);
    expectBucket(peaks.values, 0, -0.2, 0.9);
  });

  it("splits samples across buckets", () => {
    const peaks = computePeaks([1, 1, -1, -1], 2, 1);
    expect(bucket(peaks.values, 0)).toEqual([1, 1]);
    expect(bucket(peaks.values, 1)).toEqual([-1, -1]);
  });

  it("reaches the LAST sample rather than stopping a stride short", () => {
    // 7 samples into 2 buckets: a rounded stride of 3 would never read index 6.
    const peaks = computePeaks([0, 0, 0, 0, 0, 0, 0.75], 2, 1);
    expect(bucket(peaks.values, 1)[1]).toBe(0.75);
  });

  it("reports silence as a flat pair, not as noise", () => {
    const peaks = computePeaks(new Float32Array(100), 4, 1);
    expect(Array.from(peaks.values)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("survives an empty source", () => {
    const peaks = computePeaks([], 4, 2);
    expect(peaks.values).toHaveLength(8);
    expect(peakMagnitude(peaks.values)).toBe(0);
    expect(peaks.durationSeconds).toBe(2);
  });

  it("ignores non-finite samples instead of poisoning the bucket", () => {
    const peaks = computePeaks([Number.NaN, 0.5, Number.POSITIVE_INFINITY], 1, 1);
    expect(bucket(peaks.values, 0)).toEqual([0.5, 0.5]);
  });

  it("clamps a nonsense bucket count to one", () => {
    expect(computePeaks([1, 2, 3], 0, 1).values).toHaveLength(2);
    expect(computePeaks([1, 2, 3], -5, 1).values).toHaveLength(2);
  });
});

describe("bucketCountFor", () => {
  it("scales with duration at the fixed rate", () => {
    expect(bucketCountFor(1)).toBe(PEAK_BUCKETS_PER_SECOND);
    expect(bucketCountFor(10)).toBe(PEAK_BUCKETS_PER_SECOND * 10);
  });

  it("never returns zero for a degenerate duration", () => {
    expect(bucketCountFor(0)).toBe(1);
    expect(bucketCountFor(-3)).toBe(1);
    expect(bucketCountFor(Number.NaN)).toBe(1);
  });
});

describe("peaksForWindow", () => {
  /** 4 buckets over 4 seconds, each second a distinct level. */
  const peaks = {
    values: new Float32Array([-0.1, 0.1, -0.2, 0.2, -0.3, 0.3, -0.4, 0.4]),
    durationSeconds: 4,
  };

  it("returns the whole source when nothing is trimmed", () => {
    const out = peaksForWindow(peaks, 0, 0, 4);
    expectBucket(out, 0, -0.1, 0.1);
    expectBucket(out, 3, -0.4, 0.4);
  });

  it("treats trims as amounts REMOVED from each end", () => {
    // 1s off the front and 1s off the back of a 4s source leaves buckets 1..2.
    // This is the convention `mediaDurationSeconds` uses; reading them as
    // absolute offsets is the bug that shipped in the MCP write path.
    const out = peaksForWindow(peaks, 1, 1, 2);
    expectBucket(out, 0, -0.2, 0.2);
    expectBucket(out, 1, -0.3, 0.3);
  });

  it("shows only the tail when the head is trimmed", () => {
    const out = peaksForWindow(peaks, 3, 0, 1);
    expectBucket(out, 0, -0.4, 0.4);
  });

  it("returns silence when the trims consume the whole clip", () => {
    // Not a stretched full view: there is no audio in this window.
    const out = peaksForWindow(peaks, 2, 2, 4);
    expect(peakMagnitude(out)).toBe(0);
  });

  it("returns silence rather than inverting when trims exceed the source", () => {
    const out = peaksForWindow(peaks, 5, 5, 4);
    expect(peakMagnitude(out)).toBe(0);
  });

  it("repeats buckets when asked for more detail than it stores", () => {
    // Zooming past the stored resolution must not read empty ranges and draw
    // gaps where there is sound.
    const out = peaksForWindow(peaks, 0, 0, 16);
    for (let i = 0; i < 16; i += 1) {
      expect(Math.abs(bucket(out, i)[1])).toBeGreaterThan(0);
    }
  });

  it("takes the extremes when several source buckets fold into one", () => {
    const out = peaksForWindow(peaks, 0, 0, 1);
    expectBucket(out, 0, -0.4, 0.4);
  });

  it("survives an empty peaks array", () => {
    const out = peaksForWindow({ values: new Float32Array(0), durationSeconds: 5 }, 0, 0, 4);
    expect(out).toHaveLength(8);
    expect(peakMagnitude(out)).toBe(0);
  });

  it("returns silence for a zero-duration source", () => {
    const out = peaksForWindow({ values: peaks.values, durationSeconds: 0 }, 0, 0, 4);
    expect(peakMagnitude(out)).toBe(0);
  });
});

describe("peakMagnitude", () => {
  it("finds the loudest absolute value across both rails", () => {
    expect(peakMagnitude(new Float32Array([-0.9, 0.2]))).toBeCloseTo(0.9, 5);
  });

  it("is zero for silence, which callers must not divide by", () => {
    expect(peakMagnitude(new Float32Array([0, 0, 0, 0]))).toBe(0);
  });
});
