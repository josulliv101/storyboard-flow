import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPreviewTimeChannel } from "./preview-time-channel";

// FIRST COVERAGE for this module. It has always been pure state — no React, no
// DOM beyond localStorage — but it lived inside a 2,200-line `.tsx`, and this
// app's vitest cannot parse `.tsx` at all. Moving the file is what made these
// assertions possible; none of them are new behaviour.

const KEY = "storyboard:preview-audio";

function stubStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(KEY, initial);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    },
  });
  return store;
}

beforeEach(() => {
  stubStorage();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPreviewTimeChannel", () => {
  it("notifies time subscribers, and stops after unsubscribe", () => {
    const channel = createPreviewTimeChannel();
    const seen: number[] = [];
    const stop = channel.subscribe(() => seen.push(channel.get()));

    channel.set(4);
    channel.set(9);
    stop();
    channel.set(99);

    expect(seen).toEqual([4, 9]);
    // The value still moves — only the notification stopped.
    expect(channel.get()).toBe(99);
  });

  it("publishes a scrub position on the SAME listeners as time", () => {
    // Deliberate: a surface being dragged and the clock have to arrive
    // together, or playheads on other surfaces disagree for a frame.
    const channel = createPreviewTimeChannel();
    let notifications = 0;
    channel.subscribe(() => {
      notifications += 1;
    });

    channel.setScrub({ surfaceId: "strip", x: 120 });
    expect(channel.getScrub()).toEqual({ surfaceId: "strip", x: 120 });
    channel.setScrub(null);

    expect(channel.getScrub()).toBeNull();
    expect(notifications).toBe(2);
  });

  it("only notifies play subscribers on a real CHANGE", () => {
    const channel = createPreviewTimeChannel();
    let notifications = 0;
    channel.subscribePlaying(() => {
      notifications += 1;
    });

    channel.setPlaying(true);
    channel.setPlaying(true);
    channel.setPlaying(false);

    expect(notifications).toBe(2);
    expect(channel.isPlaying()).toBe(false);
  });

  it("clamps volume into 0..1 and rejects a non-finite value", () => {
    const channel = createPreviewTimeChannel();

    channel.setVolume(2.5);
    expect(channel.getVolume()).toBe(1);
    channel.setVolume(-3);
    expect(channel.getVolume()).toBe(0);
    channel.setVolume(Number.NaN);
    expect(channel.getVolume()).toBe(0);
  });

  it("persists volume and mute, and reads them back on the next channel", () => {
    const store = stubStorage();
    const first = createPreviewTimeChannel();
    first.setVolume(0.25);
    first.setMuted(true);
    expect(store.get(KEY)).toBe(JSON.stringify({ volume: 0.25, muted: true }));

    // A fresh channel is what a page reload produces.
    const second = createPreviewTimeChannel();
    expect(second.getVolume()).toBe(0.25);
    expect(second.isMuted()).toBe(true);
  });

  it("falls back to full volume when the stored preference is unusable", () => {
    // A malformed or blocked store is not worth failing a preview over — each
    // of these must degrade rather than throw.
    for (const stored of ["not json", "null", '"a string"', '{"volume":"loud"}', "{}"]) {
      stubStorage(stored);
      const channel = createPreviewTimeChannel();
      expect(channel.getVolume()).toBe(1);
      expect(channel.isMuted()).toBe(false);
    }
  });

  it("clamps an out-of-range STORED volume too", () => {
    stubStorage(JSON.stringify({ volume: 42, muted: false }));
    expect(createPreviewTimeChannel().getVolume()).toBe(1);
  });

  it("works server-side, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    const channel = createPreviewTimeChannel();
    expect(channel.getVolume()).toBe(1);
    // Must not throw — this runs during SSR before the pane ever mounts.
    expect(() => channel.setVolume(0.5)).not.toThrow();
  });
});
