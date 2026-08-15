// Cut list -> ffmpeg arguments. PURE: data in, argument arrays out, no
// spawning and no filesystem, so the part that is easy to get subtly wrong is
// unit-tested rather than discovered by watching a bad file.
//
// A .mjs module rather than app TypeScript because the worker is a standalone
// process the app does not bundle — but it is imported by a test in the app's
// suite, so it is covered like everything else.
//
// THE INVARIANT THE WHOLE FILE SERVES: every segment must come out with the
// SAME video size, frame rate, pixel format, codec, AND an audio stream. The
// concat demuxer does not transcode; it stitches. Feed it segments that
// disagree on any of those and it produces silence after the first cut, or a
// file that stalls at a join, or nothing at all — and it does so without
// failing, which is why this is normalise-then-concat rather than one pass.

/** Silent stereo audio, for sources that have none of their own. An image has
 *  no audio track and plenty of video files do not either. Concat needs every
 *  segment to have the same streams, so a missing one is SYNTHESISED rather
 *  than omitted: without this, one silent clip in a sequence silences
 *  everything after it. */
const SILENT_AUDIO = "anullsrc=channel_layout=stereo:sample_rate=48000";

/**
 * Fit the source into the output frame WITHOUT cropping: scale to fit, then
 * pad the remainder. `force_original_aspect_ratio=decrease` is what keeps a
 * portrait clip from being stretched across a landscape frame, and `setsar=1`
 * stops a non-square pixel aspect surviving into the concat, where it shows up
 * as one stretched segment among correct ones.
 */
function fitFilter(width, height) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "setsar=1",
  ].join(",");
}

/** Encoder settings shared by every segment. Being IDENTICAL across segments
 *  is the requirement; the particular values are ordinary. */
function encodeArgs(fps) {
  return [
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    // Stops a synthesised silent track, which has no natural end, from
    // extending a segment past its picture.
    "-shortest",
  ];
}

/**
 * ffmpeg arguments that turn ONE cut into one normalised segment file.
 *
 * `hasAudio` says whether the SOURCE carries an audio stream, and the caller
 * has to find out — ffmpeg cannot express "map the real audio if there is any,
 * otherwise this silence". There is no conditional mapping, and mapping both
 * would either fail on the missing stream or mix silence into real sound. So
 * the worker probes (see probeHasAudio) and the decision arrives here as data,
 * which is also what makes it testable.
 *
 * `-ss` goes BEFORE `-i` deliberately: after the input, ffmpeg decodes and
 * discards everything up to the seek point, which on a long source is the
 * difference between instant and minutes.
 */
export function segmentArgs(cut, format, outputPath, options = {}) {
  const { width, height, fps } = format;
  const hasAudio = options.hasAudio === true;
  const fit = fitFilter(width, height);
  const rate = cut.playbackRate > 0 ? cut.playbackRate : 1;

  if (cut.kind === "image") {
    // A still becomes a clip of the required length, over synthesised silence.
    return [
      "-y",
      "-loop", "1", "-t", String(cut.outputDuration), "-i", cut.src,
      "-f", "lavfi", "-t", String(cut.outputDuration), "-i", SILENT_AUDIO,
      "-vf", `${fit},fps=${fps}`,
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...encodeArgs(fps),
      outputPath,
    ];
  }

  if (cut.kind === "audio") {
    // Audio in a SEQUENCE — phase 1 has no layering — still has to occupy a
    // span of picture, so it plays over black rather than being dropped.
    return [
      "-y",
      "-f", "lavfi", "-t", String(cut.outputDuration),
      "-i", `color=c=black:s=${width}x${height}:r=${fps}`,
      "-ss", String(cut.sourceStart), "-t", String(cut.outputDuration * rate), "-i", cut.src,
      ...(rate === 1 ? [] : ["-filter:a", atempoChain(rate)]),
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...encodeArgs(fps),
      outputPath,
    ];
  }

  // VIDEO. `-t` on the input is measured in SOURCE seconds, so a rate-scaled
  // cut consumes duration x rate of source to fill duration of output.
  const videoFilters = [fit, `fps=${fps}`];
  if (rate !== 1) videoFilters.unshift(`setpts=PTS/${rate}`);

  const input = [
    "-ss", String(cut.sourceStart),
    "-t", String(cut.outputDuration * rate),
    "-i", cut.src,
  ];
  const silence = hasAudio
    ? []
    : ["-f", "lavfi", "-t", String(cut.outputDuration), "-i", SILENT_AUDIO];

  return [
    "-y",
    ...input,
    ...silence,
    "-vf", videoFilters.join(","),
    ...(hasAudio && rate !== 1 ? ["-filter:a", atempoChain(rate)] : []),
    "-map", "0:v:0",
    // The real track when there is one, the synthesised one otherwise — never
    // both, and never a `?` that would quietly yield a segment with no audio.
    "-map", hasAudio ? "0:a:0" : "1:a:0",
    ...encodeArgs(fps),
    outputPath,
  ];
}

/**
 * `atempo` accepts 0.5..2.0 per instance, so a rate outside that is chained.
 *
 * Chained rather than clamped: clamping would desync audio from a picture that
 * HAS been scaled by the full factor, which is the worst available outcome —
 * it reads as a sync bug in the render rather than as a refusal.
 */
export function atempoChain(rate) {
  const steps = [];
  let remaining = rate;
  while (remaining > 2) {
    steps.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    steps.push("atempo=0.5");
    remaining *= 2;
  }
  steps.push(`atempo=${round(remaining)}`);
  return steps.join(",");
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The concat demuxer's list file. Paths are single-quoted with embedded quotes
 * escaped, because ffmpeg's own parser treats a bare quote as a delimiter — a
 * path with an apostrophe in it would truncate the list at that line and lose
 * a shot silently.
 */
export function concatListFile(segmentPaths) {
  return segmentPaths.map((path) => `file '${path.replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/**
 * Stitch the normalised segments. `-c copy` is the point: they were already
 * encoded to identical settings, so this is a remux — fast, and it cannot
 * introduce a second generation of loss.
 */
export function concatArgs(listPath, outputPath) {
  return [
    "-y",
    "-f", "concat",
    // Required for absolute paths, which every path here is.
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    "-movflags", "+faststart",
    outputPath,
  ];
}

/** ffprobe arguments that answer "does this source have an audio stream". */
export function probeAudioArgs(src) {
  return [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=codec_type",
    "-of", "csv=p=0",
    src,
  ];
}

/**
 * How far through the render we are, from the cut currently being normalised.
 *
 * Caps below 1 deliberately: the concat still has to run after the last
 * segment, and a bar sitting at 100% through a final step is the kind of small
 * lie that makes people think a job has hung.
 */
export function segmentFraction(index, total) {
  if (total <= 0) return 0;
  return Math.min(0.95, ((index + 1) / total) * 0.95);
}

/**
 * Mix the under-layers into the concatenated picture.
 *
 * Input 0 is the picture (video + its own audio); inputs 1..N are the layer
 * segments, already normalised by `segmentArgs`, so their audio is 48k stereo
 * like everything else. Only their AUDIO is used — a layer's picture, if it
 * had one, is not composited. That is phase 2's stated limit: lanes carry
 * sound under the picture, not picture over it.
 *
 * THREE ffmpeg details, each of which is a wrong file if missed:
 *
 * `normalize=0` on amix. It defaults to ON, which divides every input by the
 * number of inputs — so adding a quiet bed would silently halve the dialogue
 * that was already there. The layers were levelled when they were made; the
 * mixer must not second-guess them.
 *
 * `duration=first` so the output follows the PICTURE. Without it amix runs to
 * the longest input and a 30s bed under 8s of picture yields 30 seconds, the
 * last 22 of them black.
 *
 * `adelay` in MILLISECONDS, and per channel — `adelay=1500|1500` for stereo.
 * A single value delays only the first channel, which is not a late start but
 * a stereo image that slides apart.
 */
export function mixArgs(picturePath, layers, outputPath) {
  if (layers.length === 0) {
    // Nothing to mix. Returning the concat's own arguments would re-encode for
    // no reason; the caller uses the picture as the finished file instead.
    return null;
  }

  const inputs = ["-i", picturePath];
  const chains = [];
  const mixLabels = ["[0:a]"];

  layers.forEach((layer, index) => {
    const streamIndex = index + 1;
    inputs.push("-i", layer.path);
    const delayMs = Math.max(0, Math.round(layer.outputStart * 1000));
    const label = `[l${streamIndex}]`;
    chains.push(`[${streamIndex}:a]adelay=${delayMs}|${delayMs}${label}`);
    mixLabels.push(label);
  });

  const filter = [
    ...chains,
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`,
  ].join(";");

  return [
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "0:v",
    "-map", "[aout]",
    // The picture is already encoded exactly right by the concat — copying it
    // keeps the mix from costing a second generation of the whole film.
    "-c:v", "copy",
    "-c:a", "aac",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    outputPath,
  ];
}
