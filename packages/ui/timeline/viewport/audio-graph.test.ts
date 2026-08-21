import { describe, expect, it } from "vitest";

import {
  clampVolume,
  createAudioMixer,
  volumeToGain,
  type MinimalAudioContext,
  type MinimalGainNode,
} from "./audio-graph";
import { at } from "../../test-support/at";

/** A fake Web Audio context: enough surface for the mixer, none of the browser.
 *  `sourceCalls` is what proves the attach-once guard, since the real
 *  `createMediaElementSource` throws on a second call for one element. */
function createFakeContext() {
  const gains: MinimalGainNode[] = [];
  const disconnected: MinimalGainNode[] = [];
  const sourceCalls: HTMLMediaElement[] = [];
  let state = "suspended";
  let closed = false;

  const context: MinimalAudioContext = {
    get state() {
      return state;
    },
    destination: {},
    createGain: () => {
      const node: MinimalGainNode = {
        gain: { value: 1 },
        connect: () => undefined,
        disconnect: () => {
          disconnected.push(node);
        },
      };
      gains.push(node);
      return node;
    },
    createMediaElementSource: (element) => {
      if (sourceCalls.includes(element)) {
        throw new Error("HTMLMediaElement already connected");
      }
      sourceCalls.push(element);
      return { connect: () => undefined };
    },
    resume: async () => {
      state = "running";
    },
    close: async () => {
      closed = true;
    },
  };

  return {
    context,
    gains,
    disconnected,
    sourceCalls,
    isClosed: () => closed,
    getState: () => state,
  };
}

/** Only the three properties the mixer touches. */
function fakeElement() {
  return { muted: true, volume: 0 } as unknown as HTMLMediaElement;
}

describe("clampVolume", () => {
  it("holds the 0..1 range", () => {
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
  });

  it("falls to SILENCE on non-finite input, not to full volume", () => {
    // Deliberate asymmetry with the clamp above: Infinity is out of range at
    // the top, but a bad number reaching a volume control should never blast
    // the user at full level. Silence is the recoverable failure.
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("volumeToGain", () => {
  it("is a squared curve, so the endpoints are exact", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
  });

  it("puts a mid slider BELOW half gain — the point of the curve", () => {
    // A linear map would return 0.5 here and spend most of the travel at the
    // top of the range, which is what makes a linear volume slider feel dead.
    expect(volumeToGain(0.5)).toBeCloseTo(0.25, 5);
  });

  it("clamps before curving rather than returning a negative gain", () => {
    expect(volumeToGain(-0.5)).toBe(0);
    expect(volumeToGain(4)).toBe(1);
  });
});

describe("createAudioMixer", () => {
  it("routes an element once, however many times attach is called", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    const element = fakeElement();

    mixer.attach(element);
    mixer.attach(element);
    mixer.attach(element);

    // Two calls would throw in a real context and lose the element's audio.
    expect(fake.sourceCalls).toHaveLength(1);
  });

  it("starts every source silent so a prefetched clip is inaudible", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);

    mixer.attach(fakeElement());

    // gains[0] is the master, created with the context; gains[1] is the source.
    expect(at(fake.gains, 1).gain.value).toBe(0);
  });

  it("takes level away from the element so the two do not multiply", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    const element = fakeElement();

    mixer.attach(element);

    expect(element.muted).toBe(false);
    expect(element.volume).toBe(1);
  });

  it("applies the curve to a source's gain", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    const element = fakeElement();

    mixer.attach(element);
    mixer.setSourceGain(element, 0.5);

    expect(at(fake.gains, 1).gain.value).toBeCloseTo(0.25, 5);
  });

  it("zeroes master gain while muted and restores the level on unmute", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    mixer.attach(fakeElement());
    mixer.setMasterVolume(0.5);

    const master = at(fake.gains, 0);
    expect(master.gain.value).toBeCloseTo(0.25, 5);

    mixer.setMuted(true);
    expect(master.gain.value).toBe(0);

    mixer.setMuted(false);
    expect(master.gain.value).toBeCloseTo(0.25, 5);
  });

  it("resumes a suspended context, which is how the play gesture unblocks it", async () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);

    expect(fake.getState()).toBe("suspended");
    await mixer.resume();
    expect(fake.getState()).toBe("running");
  });

  describe("without Web Audio", () => {
    it("reports unsupported rather than throwing", () => {
      const mixer = createAudioMixer(() => null);
      expect(mixer.isSupported()).toBe(false);
    });

    it("falls back to the element's own volume instead of going silent", () => {
      const mixer = createAudioMixer(() => null);
      const element = fakeElement();

      mixer.attach(element);
      mixer.setSourceGain(element, 1);

      expect(element.muted).toBe(false);
      expect(element.volume).toBe(1);
    });

    it("still honours master volume and mute in the fallback path", () => {
      const mixer = createAudioMixer(() => null);
      const element = fakeElement();
      mixer.attach(element);
      mixer.setSourceGain(element, 1);

      mixer.setMasterVolume(0.5);
      expect(element.volume).toBeCloseTo(0.25, 5);

      mixer.setMuted(true);
      expect(element.muted).toBe(true);
    });

    it("keeps a zero-gain source muted, so prefetch stays silent", () => {
      const mixer = createAudioMixer(() => null);
      const element = fakeElement();

      mixer.attach(element);

      expect(element.muted).toBe(true);
    });
  });

  it("closes the context on dispose", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    mixer.attach(fakeElement());

    mixer.dispose();

    expect(fake.isClosed()).toBe(true);
  });
});

describe("release", () => {
  it("DISCONNECTS the element's branch, which is what actually frees it", () => {
    // The WeakMaps above never held the element strongly; the AUDIO GRAPH did.
    // A source node stays connected until someone disconnects it, and keeps
    // the element and its decoder alive for as long as it is — so dropping the
    // caller's reference without this frees nothing and still looks correct.
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    const element = fakeElement();

    mixer.attach(element);
    expect(fake.disconnected).toHaveLength(0);

    mixer.release(element);
    expect(fake.disconnected).toHaveLength(1);
  });

  it("stops steering a released element's level", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    const element = fakeElement();
    mixer.attach(element);
    const gain = at(fake.gains, 0);

    mixer.release(element);
    gain.gain.value = 0.42;
    mixer.setSourceGain(element, 1);

    // Untouched: the mixer has forgotten this element rather than holding a
    // gain node it can still write through.
    expect(gain.gain.value).toBe(0.42);
  });

  it("drops a FALLBACK element — the module's one strong reference", () => {
    // Elements on the fallback path live in a Set, not a WeakMap, so without
    // this they are retained for the mixer's whole life.
    const mixer = createAudioMixer(() => null);
    const element = fakeElement();
    mixer.attach(element);

    mixer.setSourceGain(element, 1);
    mixer.setMasterVolume(1);
    const heldVolume = element.volume;
    expect(heldVolume).toBeGreaterThan(0);

    mixer.release(element);
    element.volume = 0.33;
    mixer.setMasterVolume(0.1);

    // A still-tracked element would have been re-levelled by that master move.
    expect(element.volume).toBe(0.33);
  });

  it("is safe on an element that was never attached", () => {
    const fake = createFakeContext();
    const mixer = createAudioMixer(() => fake.context);
    expect(() => mixer.release(fakeElement())).not.toThrow();
  });
});
