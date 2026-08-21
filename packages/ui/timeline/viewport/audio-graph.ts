/**
 * The preview's audio mixer.
 *
 * The surface plays its clips through off-DOM `<video>` elements. Routing those
 * through Web Audio rather than just unmuting them buys ONE thing that matters
 * later: a place where independent sources can be summed. A background-music
 * track becomes another `attach`ed element with its own gain, and the playback
 * loop does not change.
 *
 * Pure of React and of the DOM-framework layer, like `playback-skip.ts` beside
 * it — the arithmetic below is exported separately so it tests without a DOM.
 *
 * TWO constraints drive the shape of this file:
 *
 *  - `createMediaElementSource` THROWS if called twice for the same element,
 *    and the surface caches and reuses its elements across seeks. Hence the
 *    `WeakMap` guard; `attach` is idempotent by contract.
 *  - Routing an element through Web Audio is a ONE-WAY DOOR: from then on its
 *    output reaches the speakers only through this graph. So `attach` also
 *    neutralises the element's own controls (`muted = false`, `volume = 1`),
 *    or the two attenuations would multiply.
 */

/** Volume and gain both live in 0..1. */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Perceived loudness is closer to the square of amplitude than to amplitude, so
 * a linear slider mapped straight to gain spends most of its travel in the top
 * of the range and feels dead at the bottom. Squaring puts the useful detail
 * where the hand is.
 */
export function volumeToGain(volume: number): number {
  const safe = clampVolume(volume);
  return safe * safe;
}

/** The subset of `AudioContext` this module uses — narrow so a test can fake it
 *  without standing up Web Audio, and so no `any` is needed. */
export type MinimalGainNode = {
  gain: {
    value: number;
    /** Present on a real `AudioParam`. Optional here because the type exists to
     *  be fakeable, and because a param without it still works — see
     *  `writeGain`, which falls back to assignment. */
    setTargetAtTime?: (target: number, startTime: number, timeConstant: number) => void;
    cancelScheduledValues?: (startTime: number) => void;
  };
  connect: (destination: MinimalGainNode | MinimalAudioDestination) => void;
  disconnect: () => void;
};

export type MinimalAudioDestination = { readonly __brand?: "destination" };

export type MinimalAudioContext = {
  readonly state: string;
  /** The audio clock. Absent on an older fake, which `writeGain` reads as
   *  "cannot schedule" and handles. */
  readonly currentTime?: number;
  readonly destination: MinimalAudioDestination;
  createGain: () => MinimalGainNode;
  createMediaElementSource: (element: HTMLMediaElement) => { connect: (node: MinimalGainNode) => void };
  resume: () => Promise<void>;
  close: () => Promise<void>;
};

export type AudioMixer = {
  /** Route an element into the mixer. Idempotent — safe to call on every cache
   *  hit. A no-op when Web Audio is unavailable. */
  attach: (element: HTMLMediaElement) => void;
  /** Per-source level, 0..1. This is how the active clip is heard and the
   *  prefetched and disabled ones are held silent. */
  setSourceGain: (element: HTMLMediaElement, volume: number) => void;
  /**
   * Let go of an element the caller is discarding.
   *
   * The counterpart to `attach`, and the reason eviction is possible at all: a
   * `MediaElementAudioSourceNode` stays connected to the graph for as long as
   * nobody disconnects it, and while connected it keeps the element — and its
   * decoder — alive no matter what the caller does with its own references.
   * The `WeakMap`s cannot help here, because the audio graph IS the strong
   * reference.
   *
   * ONE-WAY. Web Audio gives an element exactly one source node for the
   * lifetime of the context, so a released element can never be attached
   * again. Callers must be finished with it — the surface clears `src` and
   * drops the element in the same breath.
   */
  release: (element: HTMLMediaElement) => void;
  setMasterVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  /** Browsers start the context suspended until a user gesture. Call from the
   *  play handler; resolves either way so callers need no branch. */
  resume: () => Promise<void>;
  /** False when Web Audio is missing (SSR, jsdom, ancient browsers). Callers
   *  degrade to element-level volume — see `setSourceGain`. */
  isSupported: () => boolean;
  dispose: () => void;
};

type AudioContextConstructor = new () => MinimalAudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * How quickly a gain change reaches its target, as `setTargetAtTime`'s time
 * constant.
 *
 * FIVE MILLISECONDS, which is not a fade — it is the shortest ramp that is
 * still a ramp. A gain assigned outright steps the waveform from one value to
 * another between two adjacent samples, and a discontinuity is exactly what a
 * click IS: the ear hears the edge, not the level. That happens here at every
 * cut (the outgoing clip drops to zero mid-waveform while the incoming one
 * starts at full), on every mute, and on every step of a volume drag.
 *
 * Short enough that a cut still lands on the frame it belongs to — five
 * milliseconds is an eighth of a frame at 24fps — and long enough that the
 * transition spans hundreds of samples instead of one.
 */
const GAIN_RAMP_SECONDS = 0.005;

/**
 * Move a gain to a new value without stepping it.
 *
 * Falls back to assignment when the param cannot schedule — an old fake, a
 * context that never came up — so the mixer's behaviour degrades to what it
 * was rather than throwing.
 */
function writeGain(
  node: MinimalGainNode,
  target: number,
  context: MinimalAudioContext | null,
): void {
  const param = node.gain;
  const now = context?.currentTime;
  if (typeof param.setTargetAtTime === "function" && typeof now === "number") {
    // Anything still scheduled is a ramp toward a level that is no longer
    // wanted; leaving it queued would have the new target fight it.
    param.cancelScheduledValues?.(now);
    param.setTargetAtTime(target, now, GAIN_RAMP_SECONDS);
    return;
  }
  param.value = target;
}

/**
 * `createContext` is injectable so the unit test can drive a fake and assert
 * the attach-once and gain behavior without Web Audio.
 */
export function createAudioMixer(
  createContext: () => MinimalAudioContext | null = () => {
    const Ctor = resolveAudioContextConstructor();
    return Ctor ? new Ctor() : null;
  },
): AudioMixer {
  let context: MinimalAudioContext | null = null;
  let master: MinimalGainNode | null = null;
  let unsupported = false;
  let masterVolume = 1;
  let muted = false;
  const gains = new WeakMap<HTMLMediaElement, MinimalGainNode>();
  /** Levels are remembered even when Web Audio is absent, so the element-volume
   *  fallback and the master control compose the same way. */
  const levels = new WeakMap<HTMLMediaElement, number>();
  const fallbackElements = new Set<HTMLMediaElement>();

  function ensureContext(): MinimalAudioContext | null {
    if (context || unsupported) return context;
    const created = createContext();
    if (!created) {
      unsupported = true;
      return null;
    }
    context = created;
    master = created.createGain();
    master.gain.value = muted ? 0 : volumeToGain(masterVolume);
    master.connect(created.destination);
    return context;
  }

  /** Without Web Audio the element's own controls are all there is. Master
   *  volume and mute still have to apply, so fold them in here. */
  function applyFallback(element: HTMLMediaElement) {
    const level = levels.get(element) ?? 0;
    element.muted = muted || level <= 0;
    element.volume = clampVolume(volumeToGain(level * masterVolume));
  }

  function applyAllFallbacks() {
    for (const element of fallbackElements) applyFallback(element);
  }

  return {
    attach(element) {
      if (gains.has(element)) return;

      const ctx = ensureContext();
      if (!ctx || !master) {
        // Degrade rather than go silent: the element keeps its own volume.
        fallbackElements.add(element);
        if (!levels.has(element)) levels.set(element, 0);
        applyFallback(element);
        return;
      }

      const gain = ctx.createGain();
      // Start silent. The surface raises the ACTIVE clip; everything the
      // prefetch window pulled in stays down until it is the one playing.
      gain.gain.value = 0;
      gain.connect(master);

      try {
        ctx.createMediaElementSource(element).connect(gain);
      } catch {
        // Already routed by someone else, or the element is not eligible.
        // Falling back keeps sound rather than losing it to a thrown guard.
        gain.disconnect();
        fallbackElements.add(element);
        if (!levels.has(element)) levels.set(element, 0);
        applyFallback(element);
        return;
      }

      // The element's own attenuation would multiply with the graph's, so the
      // graph takes sole ownership of level from here.
      element.muted = false;
      element.volume = 1;
      gains.set(element, gain);
      if (!levels.has(element)) levels.set(element, 0);
    },

    setSourceGain(element, volume) {
      const level = clampVolume(volume);
      levels.set(element, level);
      const gain = gains.get(element);
      if (gain) {
        writeGain(gain, volumeToGain(level), context);
        return;
      }
      if (fallbackElements.has(element)) applyFallback(element);
    },

    release(element) {
      const gain = gains.get(element);
      if (gain) {
        // Disconnecting the GAIN detaches this element's whole branch: the
        // source node upstream has nowhere left to reach, so the graph stops
        // holding it. `createMediaElementSource` cannot be undone, which is
        // precisely why the caller must be done with the element.
        gain.disconnect();
        gains.delete(element);
      }
      levels.delete(element);
      // A Set, unlike the maps above, is a STRONG reference — an element that
      // fell back to element-level volume would otherwise be retained here for
      // the mixer's whole life, which is the one leak in this module.
      fallbackElements.delete(element);
    },

    setMasterVolume(volume) {
      masterVolume = clampVolume(volume);
      if (master && !muted) writeGain(master, volumeToGain(masterVolume), context);
      applyAllFallbacks();
    },

    setMuted(next) {
      muted = next;
      if (master) writeGain(master, next ? 0 : volumeToGain(masterVolume), context);
      applyAllFallbacks();
    },

    async resume() {
      const ctx = ensureContext();
      if (!ctx) return;
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          // A refused resume is not actionable here — the surface reports the
          // blocked state from the rejected play() instead.
        }
      }
    },

    isSupported() {
      // Probe rather than report "unknown": callers ask this to decide how to
      // label the control, before anything has been attached.
      return ensureContext() !== null;
    },

    dispose() {
      const ctx = context;
      context = null;
      master = null;
      fallbackElements.clear();
      if (ctx) void ctx.close().catch(() => undefined);
    },
  };
}
