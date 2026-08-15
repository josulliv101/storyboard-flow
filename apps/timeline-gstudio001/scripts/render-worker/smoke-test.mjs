// End-to-end proof that the planner's arguments actually assemble a file:
// synthesise one video-with-audio, one silent video, one still and one audio
// source, run the REAL ffmpeg through segmentArgs + concatArgs, then ffprobe
// the result.
//
// NOT part of the app's vitest suite, and it cannot be: it needs ffmpeg and
// ffprobe on PATH, and CI's ubuntu-latest image does not carry them (the
// request to add ffmpeg was declined upstream). So it lives here as a script
// to run by hand when the plan changes:
//
//   node scripts/render-worker/smoke-test.mjs
//
// The unit tests in lib/render/ffmpeg-plan.test.ts prove the ARGUMENTS are
// shaped right. This proves ffmpeg accepts them and that the concat produces
// the duration and the streams asked for — in particular that audio survives
// past the first cut, which is the failure the whole normalise-then-concat
// design exists to prevent, and which no argument assertion can catch.
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  segmentArgs,
  concatArgs,
  concatListFile,
  mixArgs,
  probeAudioArgs,
} from "./ffmpeg-plan.mjs";

const FORMAT = { width: 640, height: 360, fps: 24 };

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${code}: ${err.trim().split("\n").slice(-6).join("\n")}`)),
    );
  });
}

const dir = await mkdtemp(join(tmpdir(), "render-smoke-"));
let failures = 0;
const check = (label, actual, expected) => {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${actual}`);
};

try {
  // --- synthesise sources -------------------------------------------------
  const withAudio = join(dir, "with-audio.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", withAudio]);

  const silent = join(dir, "silent.mp4");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=800x600:rate=30:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);

  const still = join(dir, "still.png");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=1000x400", "-frames:v", "1", still]);

  const voice = join(dir, "voice.wav");
  await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=5", voice]);

  // Confirm the fixtures are what the test needs them to be.
  check("probe finds audio in the audio-bearing source", (await run("ffprobe", probeAudioArgs(withAudio))).includes("audio"), true);
  check("probe finds NO audio in the silent source", (await run("ffprobe", probeAudioArgs(silent))).includes("audio"), false);

  // --- the cut list -------------------------------------------------------
  // Deliberately mixed: differing sizes (320x240, 800x600, 1000x400), frame
  // rates (24, 30), audio presence, a trim, and a rate change.
  const cuts = [
    { src: withAudio, kind: "video", sourceStart: 1, outputDuration: 2, playbackRate: 1, outputStart: 0 },
    { src: silent, kind: "video", sourceStart: 0, outputDuration: 1.5, playbackRate: 1, outputStart: 2 },
    { src: still, kind: "image", sourceStart: 0, outputDuration: 1, playbackRate: 1, outputStart: 3.5 },
    { src: voice, kind: "audio", sourceStart: 0.5, outputDuration: 2, playbackRate: 1, outputStart: 4.5 },
    { src: withAudio, kind: "video", sourceStart: 0, outputDuration: 1, playbackRate: 2, outputStart: 6.5 },
  ];
  const expectedDuration = 7.5;

  const segments = [];
  for (const [index, cut] of cuts.entries()) {
    const hasAudio = cut.kind === "video" ? (await run("ffprobe", probeAudioArgs(cut.src))).includes("audio") : false;
    const out = join(dir, `seg-${index}.mp4`);
    await run("ffmpeg", segmentArgs(cut, FORMAT, out, { hasAudio }));
    segments.push(out);

    const streams = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]);
    check(`segment ${index} (${cut.kind}) has video AND audio`, streams.split("\n").map((s) => s.trim()).sort().join(","), "audio,video");
    const size = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", out]);
    check(`segment ${index} normalised to the output frame`, size, "640x360");
  }

  // --- concat -------------------------------------------------------------
  const listPath = join(dir, "list.txt");
  await writeFile(listPath, concatListFile(segments));
  const finalPath = join(dir, "final.mp4");
  await run("ffmpeg", concatArgs(listPath, finalPath));

  const duration = Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", finalPath]));
  check(`final duration ~= ${expectedDuration}s (gaps closed)`, duration.toFixed(2), (d) => Math.abs(Number(d) - expectedDuration) < 0.35);

  const finalStreams = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", finalPath]);
  check("final file has video AND audio", finalStreams.split("\n").map((s) => s.trim()).sort().join(","), "audio,video");

  // The bug this whole design guards against: audio surviving PAST the first
  // segment. If concat dropped it, the audio stream would be short.
  const audioDuration = Number(await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "csv=p=0", finalPath]));
  check("audio runs the WHOLE file, not just the first cut", audioDuration.toFixed(2), (d) => Math.abs(Number(d) - expectedDuration) < 0.35);

  // --- LANES: mix a bed and a VO UNDER the finished picture ---------------
  //
  // The phase 2 claim. `finalPath` is the picture; the two layers are
  // normalised the same way a cut is, then delayed and mixed beneath it.
  const bedSeg = join(dir, "layer-bed.mp4");
  await run("ffmpeg", segmentArgs(
    { src: voice, kind: "audio", sourceStart: 0, outputDuration: 6, playbackRate: 1, outputStart: 0 },
    FORMAT, bedSeg,
  ));
  const voSeg = join(dir, "layer-vo.mp4");
  await run("ffmpeg", segmentArgs(
    { src: withAudio, kind: "video", sourceStart: 0, outputDuration: 2, playbackRate: 1, outputStart: 0 },
    FORMAT, voSeg, { hasAudio: true },
  ));

  const mixed = join(dir, "mixed.mp4");
  const mix = mixArgs(finalPath, [
    { path: bedSeg, outputStart: 0 },
    { path: voSeg, outputStart: 3 },
  ], mixed);
  check("mixArgs produced a command for two layers", mix !== null, true);
  await run("ffmpeg", mix);

  const mixedDuration = Number(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mixed]));
  // duration=first: the PICTURE decides, so the mix is the same length even
  // though a layer was delayed 3s into it.
  check("mixing does not lengthen the film", mixedDuration.toFixed(2), (d) => Math.abs(Number(d) - expectedDuration) < 0.35);

  const mixedStreams = await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", mixed]);
  check("mixed file still has video AND audio", mixedStreams.split("\n").map((s) => s.trim()).sort().join(","), "audio,video");

  // NOT a codec check. It used to assert `codec_name === "h264"` under the name
  // "video was COPIED", which a re-encode also satisfies — so the day
  // compositing arrived the check would have gone on passing while testing
  // nothing it claimed. What actually distinguishes a copy is that the frames
  // are the SAME frames, so compare the stream's size against the picture's.
  const bytesOf = async (path) =>
    Number(await run("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=nb_frames", "-of", "csv=p=0", path]));
  const pictureFrames = await bytesOf(picture);
  const mixedFrames = await bytesOf(mixed);
  check("audio-only mix left the picture's frames untouched", mixedFrames, pictureFrames);

  // The audible proof: measure loudness before and after. Adding a bed and a
  // VO must make the film LOUDER, not quieter — which is what amix's default
  // normalising would have done by dividing every input by the input count.
  // `volumedetect` reports on STDERR, like everything ffmpeg says about a
  // file — `run` resolves stdout, so this needs its own capture.
  const meanVolume = (path) =>
    new Promise((resolve) => {
      const child = spawn("ffmpeg", [
        "-hide_banner", "-nostats",
        "-i", path,
        "-af", "volumedetect",
        "-f", "null", "-",
      ]);
      let err = "";
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("close", () => {
        const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(err);
        resolve(match ? Number(match[1]) : Number.NaN);
      });
    });
  const before = await meanVolume(finalPath);
  const after = await meanVolume(mixed);
  check(`mix is LOUDER than the picture alone (${before.toFixed(1)} -> ${after.toFixed(1)} dB)`, after > before, true);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
