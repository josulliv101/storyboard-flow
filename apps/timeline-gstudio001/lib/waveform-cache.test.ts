import { describe, expect, it, vi } from "vitest";

import { createWaveformCache, waveformKeyFor } from "./waveform-cache";

/** A decoded buffer stand-in: one channel of a constant level. */
function fakeBuffer(level: number, duration = 1) {
  const data = new Float32Array(1000).fill(level);
  return { getChannelData: () => data, duration };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("waveformKeyFor", () => {
  it("keys on the asset, so one upload placed twice decodes once", () => {
    const asset = { providerId: "cloudinary", assetId: "folder/render-123" };
    const first = waveformKeyFor({ src: "https://cdn/a.mp4?v=1", sourceAsset: asset });
    const second = waveformKeyFor({ src: "https://cdn/a.mp4?v=2", sourceAsset: asset });

    // Different URLs, same asset — the URLs carry cache-busting versions.
    expect(first).toBe(second);
  });

  it("falls back to src for clips minted before provenance existed", () => {
    expect(waveformKeyFor({ src: "https://cdn/a.mp4" })).toBe("src:https://cdn/a.mp4");
  });

  it("returns null when there is nothing to key on", () => {
    expect(waveformKeyFor({})).toBeNull();
  });
});

describe("createWaveformCache", () => {
  it("decodes once and serves the rest from memory", async () => {
    const fetchBytes = vi.fn(async () => new ArrayBuffer(8));
    const decode = vi.fn(async () => fakeBuffer(0.5));
    const cache = createWaveformCache({ fetchBytes, decode });

    await cache.request("asset-a", "https://cdn/a.mp4");
    await cache.request("asset-a", "https://cdn/a.mp4");
    await cache.request("asset-a", "https://cdn/a.mp4");

    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests for the same asset", async () => {
    const gate = deferred<ArrayBuffer>();
    const fetchBytes = vi.fn(() => gate.promise);
    const decode = vi.fn(async () => fakeBuffer(0.5));
    const cache = createWaveformCache({ fetchBytes, decode });

    const a = cache.request("asset-a", "https://cdn/a.mp4");
    const b = cache.request("asset-a", "https://cdn/a.mp4");
    gate.resolve(new ArrayBuffer(8));
    await Promise.all([a, b]);

    // Two callers, one network trip — the strip asks per visible card.
    expect(fetchBytes).toHaveBeenCalledTimes(1);
  });

  it("peek is synchronous and empty until the decode lands", async () => {
    const gate = deferred<ArrayBuffer>();
    const cache = createWaveformCache({
      fetchBytes: () => gate.promise,
      decode: async () => fakeBuffer(0.25),
    });

    const pending = cache.request("asset-a", "https://cdn/a.mp4");
    // The paint path calls peek and must never await.
    expect(cache.peek("asset-a")).toBeNull();

    gate.resolve(new ArrayBuffer(8));
    await pending;
    expect(cache.peek("asset-a")).not.toBeNull();
  });

  it("caps concurrent decodes", async () => {
    let active = 0;
    let highWater = 0;
    const gates: Array<() => void> = [];
    const cache = createWaveformCache({
      maxConcurrent: 2,
      fetchBytes: async () => {
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise<void>((resolve) => gates.push(resolve));
        active -= 1;
        return new ArrayBuffer(8);
      },
      decode: async () => fakeBuffer(0.5),
    });

    const all = Promise.all(
      ["a", "b", "c", "d", "e"].map((key) => cache.request(key, `https://cdn/${key}.mp4`)),
    );
    // Let the admitted ones start, then drain.
    await Promise.resolve();
    await Promise.resolve();
    while (gates.length > 0) {
      gates.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    await all;

    // Each decode pulls a whole file; five at once is what this prevents.
    expect(highWater).toBeLessThanOrEqual(2);
  });

  it("remembers a failure instead of refetching on every scroll", async () => {
    const fetchBytes = vi.fn(async () => {
      throw new Error("network");
    });
    const cache = createWaveformCache({ fetchBytes, decode: async () => fakeBuffer(0.5) });

    expect(await cache.request("asset-a", "https://cdn/a.mp4")).toBeNull();
    expect(await cache.request("asset-a", "https://cdn/a.mp4")).toBeNull();

    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(cache.peek("asset-a")).toBeNull();
  });

  it("treats an undecodable file as a failure, not a crash", async () => {
    // A clip with no audio track, or a container the browser will not decode.
    const cache = createWaveformCache({
      fetchBytes: async () => new ArrayBuffer(8),
      decode: async () => {
        throw new Error("EncodingError");
      },
    });

    await expect(cache.request("asset-a", "https://cdn/a.mp4")).resolves.toBeNull();
  });

  it("notifies subscribers when peaks land, so the lane can repaint", async () => {
    const listener = vi.fn();
    const cache = createWaveformCache({
      fetchBytes: async () => new ArrayBuffer(8),
      decode: async () => fakeBuffer(0.5),
    });
    cache.subscribe(listener);

    await cache.request("asset-a", "https://cdn/a.mp4");

    expect(listener).toHaveBeenCalled();
  });

  it("carries the decoded duration onto the peaks", async () => {
    const cache = createWaveformCache({
      fetchBytes: async () => new ArrayBuffer(8),
      decode: async () => fakeBuffer(0.5, 5.167),
    });

    const peaks = await cache.request("asset-a", "https://cdn/a.mp4");
    // peaksForWindow maps trims against this, so a wrong duration skews the lane.
    expect(peaks?.durationSeconds).toBeCloseTo(5.167, 3);
  });
});
