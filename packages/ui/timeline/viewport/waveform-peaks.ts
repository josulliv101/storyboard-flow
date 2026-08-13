/**
 * Waveform peaks: the arithmetic behind the scrubbing waveform.
 *
 * Pure of React and the DOM, like `playback-skip.ts` and `audio-graph.ts` beside
 * it — decoding and drawing live elsewhere, so all of this tests in a node
 * environment (the app's vitest globs `.test.ts` only, see
 * `graph-playhead-model.ts`).
 *
 * Peaks are stored PER ASSET at a fixed resolution, never per clip. Two clips
 * can share one asset at different trims, and the zoom slider changes card width
 * continuously — so the stored array is the whole source at a known bucket rate,
 * and `peaksForWindow` re-samples it to whatever the card currently needs.
 */

/** Buckets per second of source. Fine enough that a syllable is visible at
 *  normal zoom, coarse enough that a 60s clip is ~2400 pairs rather than
 *  millions of samples. */
export const PEAK_BUCKETS_PER_SECOND = 40;

/**
 * A min/max envelope, interleaved as `[min0, max0, min1, max1, …]`.
 *
 * Min AND max, not absolute peak: a waveform drawn from absolute values is
 * symmetric and loses the asymmetry that makes speech read as speech. One flat
 * array rather than two, so it survives a JSON round trip cheaply.
 */
export type Peaks = Readonly<{
  /** Interleaved min/max pairs; length is `bucketCount * 2`. */
  values: Float32Array;
  /** Source seconds the array covers — needed to map a trim window onto it. */
  durationSeconds: number;
}>;

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > max) return max;
  return Math.floor(value);
}

/**
 * Reduce raw mono samples to `bucketCount` min/max pairs.
 *
 * Buckets are computed from exact fractional boundaries rather than a rounded
 * stride: a rounded stride drifts, and over a long clip the last bucket ends up
 * reading a different amount of audio than the first.
 */
export function computePeaks(
  samples: ArrayLike<number>,
  bucketCount: number,
  durationSeconds: number,
): Peaks {
  const buckets = Math.max(1, Math.floor(bucketCount));
  const values = new Float32Array(buckets * 2);
  const length = samples.length;

  if (length === 0) {
    return { values, durationSeconds: Math.max(0, durationSeconds) };
  }

  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = clampIndex((bucket * length) / buckets, length - 1);
    // The final bucket must reach the LAST sample, not stop a stride short.
    const rawEnd = ((bucket + 1) * length) / buckets;
    const end = bucket === buckets - 1 ? length : clampIndex(rawEnd, length);

    let min = 0;
    let max = 0;
    let seen = false;
    for (let i = start; i < end; i += 1) {
      const value = samples[i];
      // `Number.isFinite` already rejects undefined at runtime, but it is not a
      // type guard — the explicit check is what lets `min`/`max` stay numbers.
      if (value === undefined || !Number.isFinite(value)) continue;
      if (!seen) {
        min = value;
        max = value;
        seen = true;
        continue;
      }
      if (value < min) min = value;
      if (value > max) max = value;
    }

    values[bucket * 2] = min;
    values[bucket * 2 + 1] = max;
  }

  return { values, durationSeconds: Math.max(0, durationSeconds) };
}

/** How many buckets a source of this length should be reduced to. */
export function bucketCountFor(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  return Math.max(1, Math.round(durationSeconds * PEAK_BUCKETS_PER_SECOND));
}

/**
 * Re-sample an asset's peaks to the clip's visible window.
 *
 * `trimIn` / `trimOut` are AMOUNTS REMOVED from each end — the convention the
 * core uses (`mediaDurationSeconds` computes `full - trimIn - trimOut`), and the
 * one that cost a bug in the MCP write path. An untrimmed clip is 0/0.
 *
 * Returns `outBuckets` interleaved min/max pairs covering only the played span,
 * so the drawing code maps bucket index straight to x across the card.
 */
export function peaksForWindow(
  peaks: Peaks,
  trimIn: number,
  trimOut: number,
  outBuckets: number,
): Float32Array {
  const count = Math.max(1, Math.floor(outBuckets));
  const out = new Float32Array(count * 2);
  const totalBuckets = Math.floor(peaks.values.length / 2);
  if (totalBuckets === 0) return out;

  const duration = peaks.durationSeconds;
  const safeIn = Number.isFinite(trimIn) && trimIn > 0 ? trimIn : 0;
  const safeOut = Number.isFinite(trimOut) && trimOut > 0 ? trimOut : 0;
  const played = duration - safeIn - safeOut;
  // A window trimmed to nothing (or a clip whose trims exceed its source) has
  // no audio to show. Silence is the honest answer, not a stretched full view.
  if (!(played > 0) || !(duration > 0)) return out;

  const startBucket = (safeIn / duration) * totalBuckets;
  const endBucket = ((duration - safeOut) / duration) * totalBuckets;
  const span = endBucket - startBucket;

  for (let i = 0; i < count; i += 1) {
    const from = startBucket + (i * span) / count;
    const to = startBucket + ((i + 1) * span) / count;
    const fromIndex = clampIndex(from, totalBuckets - 1);
    // Always consume at least one source bucket: zooming in past the stored
    // resolution must repeat buckets, not read an empty range and draw a gap.
    const toIndex = Math.max(fromIndex + 1, clampIndex(to, totalBuckets));

    let min = 0;
    let max = 0;
    let seen = false;
    for (let b = fromIndex; b < toIndex && b < totalBuckets; b += 1) {
      const bucketMin = peaks.values[b * 2];
      const bucketMax = peaks.values[b * 2 + 1];
      // Buckets are written in min/max PAIRS, so both halves exist for any b
      // inside the loop bound. Skipping a half-written pair keeps the running
      // min/max as numbers instead of letting one `undefined` poison the whole
      // span into NaN and flatten the lane.
      if (bucketMin === undefined || bucketMax === undefined) continue;
      if (!seen) {
        min = bucketMin;
        max = bucketMax;
        seen = true;
        continue;
      }
      if (bucketMin < min) min = bucketMin;
      if (bucketMax > max) max = bucketMax;
    }

    out[i * 2] = min;
    out[i * 2 + 1] = max;
  }

  return out;
}

/**
 * The loudest absolute value across an envelope, for normalising the draw.
 *
 * Generated renders come out quiet and inconsistent — the clips this was built
 * against peaked between -17 and -11 dB — so drawing raw amplitude makes a whole
 * lane look flat. Returns 0 for silence, and callers must not divide by it
 * blindly.
 */
export function peakMagnitude(values: Float32Array): number {
  let peak = 0;
  // for...of over a Float32Array yields numbers directly — no index, nothing
  // to be undefined.
  for (const value of values) {
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}
