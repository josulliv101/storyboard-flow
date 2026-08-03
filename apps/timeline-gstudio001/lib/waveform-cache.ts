/**
 * Peaks for the scrubbing waveform: fetch, decode, reduce, remember.
 *
 * Keyed by the ASSET, not the clip. One upload placed five times on a timeline
 * decodes once — `sourceAsset.assetId` is the durable identity for exactly this
 * (see docs/asset-providers.md), and falling back to the src URL keeps clips
 * that predate provenance working.
 *
 * Nothing here is persisted to the timeline document. Peaks are derived data:
 * putting them on the stored model would bloat every save (the gateway already
 * warns when a document outgrows the keepalive budget) and would duplicate the
 * same array once per placement.
 *
 * Decoding uses its OWN `OfflineAudioContext`, deliberately not the preview
 * mixer's context: `audio-graph.ts` keeps a narrow context type on purpose, and
 * routing media through it is a one-way door. Decoding wants none of that.
 */

import {
  bucketCountFor,
  computePeaks,
  type Peaks,
} from "@storyboard/ui/timeline/viewport/waveform-peaks";

/** Each decode fetches a WHOLE file. A strip can hold dozens of clips, so the
 *  cache admits a few at a time rather than opening every connection at once —
 *  same reasoning as MAX_CONCURRENT_MEDIA on the upload path. */
const MAX_CONCURRENT_DECODES = 3;

/** Marks an asset we tried and could not decode, so scrolling past it does not
 *  re-fetch the file every time. */
const FAILED = "failed" as const;

type Entry = Peaks | typeof FAILED;

export type WaveformCache = {
  /** Peaks if they are already known, else null. Synchronous — the drawing code
   *  must never await inside a paint. */
  peek: (key: string) => Peaks | null;
  /** Kick off a decode if this asset has neither succeeded nor failed. Returns
   *  the peaks when they land, or null. Safe to call repeatedly. */
  request: (key: string, src: string) => Promise<Peaks | null>;
  /** Called whenever an entry resolves, so a view can repaint. */
  subscribe: (listener: () => void) => () => void;
  size: () => number;
  clear: () => void;
};

export type WaveformCacheOptions = {
  /** Injected for tests; defaults to the real network. */
  fetchBytes?: (src: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** Injected for tests; defaults to OfflineAudioContext.decodeAudioData. */
  decode?: (bytes: ArrayBuffer) => Promise<{ getChannelData: (channel: number) => Float32Array; duration: number }>;
  maxConcurrent?: number;
};

async function defaultFetchBytes(src: string, signal: AbortSignal): Promise<ArrayBuffer> {
  // Same CORS story as the preview's media elements: the response must be
  // readable, which Cloudinary allows (`Access-Control-Allow-Origin: *`).
  const response = await fetch(src, { signal, mode: "cors" });
  if (!response.ok) throw new Error(`waveform fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

async function defaultDecode(bytes: ArrayBuffer) {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { OfflineAudioContext?: new (channels: number, length: number, rate: number) => BaseAudioContext })
          .OfflineAudioContext;
  if (!Ctor) throw new Error("OfflineAudioContext unavailable");
  // Length and rate are irrelevant to decoding; the context is only a decoder.
  const context = new Ctor(1, 1, 44100);
  return context.decodeAudioData(bytes);
}

export function createWaveformCache(options: WaveformCacheOptions = {}): WaveformCache {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  const decode = options.decode ?? defaultDecode;
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? MAX_CONCURRENT_DECODES);

  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<Peaks | null>>();
  const queue: Array<() => void> = [];
  const listeners = new Set<() => void>();
  let active = 0;

  function notify() {
    for (const listener of listeners) listener();
  }

  function pump() {
    while (active < maxConcurrent && queue.length > 0) {
      const next = queue.shift();
      if (next) {
        active += 1;
        next();
      }
    }
  }

  /** Resolves only when a slot frees up, which is what bounds concurrency. */
  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      queue.push(resolve);
      pump();
    });
  }

  function release() {
    active = Math.max(0, active - 1);
    pump();
  }

  async function load(key: string, src: string): Promise<Peaks | null> {
    await acquire();
    const controller = new AbortController();
    try {
      const bytes = await fetchBytes(src, controller.signal);
      const buffer = await decode(bytes);
      const duration = Number.isFinite(buffer.duration) ? buffer.duration : 0;
      const peaks = computePeaks(
        buffer.getChannelData(0),
        bucketCountFor(duration),
        duration,
      );
      entries.set(key, peaks);
      return peaks;
    } catch {
      // A clip with no audio track, an unsupported container, or a network
      // failure all land here. Remember the failure so the lane simply draws
      // nothing for this asset instead of retrying on every scroll.
      entries.set(key, FAILED);
      return null;
    } finally {
      release();
      inFlight.delete(key);
      notify();
    }
  }

  return {
    peek(key) {
      const entry = entries.get(key);
      return entry === undefined || entry === FAILED ? null : entry;
    },

    request(key, src) {
      const entry = entries.get(key);
      if (entry === FAILED) return Promise.resolve(null);
      if (entry !== undefined) return Promise.resolve(entry);

      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = load(key, src);
      inFlight.set(key, promise);
      return promise;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    size: () => entries.size,

    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}

/**
 * The cache key for a clip: its asset's durable id when it has one, else the
 * source URL. Two placements of one upload MUST agree here or the file is
 * decoded twice.
 */
export function waveformKeyFor(
  clip: Readonly<{ src?: string; sourceAsset?: Readonly<{ providerId: string; assetId: string }> }>,
): string | null {
  if (clip.sourceAsset) return `${clip.sourceAsset.providerId}:${clip.sourceAsset.assetId}`;
  return clip.src ? `src:${clip.src}` : null;
}

/** Process-wide instance. The decoded result is identical for every view, so
 *  sharing one cache is what makes the grid and the strip cheap together. */
let shared: WaveformCache | null = null;

export function sharedWaveformCache(): WaveformCache {
  shared ??= createWaveformCache();
  return shared;
}
