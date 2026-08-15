#!/usr/bin/env node
// The render worker: claims a job, assembles it with ffmpeg, uploads the file.
//
// IT RUNS ANYWHERE. Nothing about it is specific to the owner's machine —
// every connection is OUTBOUND to the app, so it needs no address, no inbound
// port and no tunnel. Point it at a deployment, give it the shared secret, and
// it works from a laptop, a container, or a CI runner. That is the whole point
// of treating "local" as a third party: the day this moves to a hosted runner,
// this file is what moves.
//
// Usage:
//   RENDER_APP_URL=https://your-app RENDER_WORKER_SECRET=... \
//     node scripts/render-worker/index.mjs
//
// Optional: RENDER_WORKER_ID (defaults to hostname+pid),
//           RENDER_PROVIDER_ID (defaults to "local"),
//           RENDER_POLL_SECONDS (defaults to 10).

import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  concatArgs,
  concatListFile,
  mixArgs,
  probeAudioArgs,
  segmentArgs,
  segmentFraction,
  layerRectPixels,
} from "./ffmpeg-plan.mjs";

const APP_URL = (process.env.RENDER_APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.RENDER_WORKER_SECRET ?? "";
const WORKER_ID = process.env.RENDER_WORKER_ID ?? `${hostname()}-${process.pid}`;
const PROVIDER_ID = process.env.RENDER_PROVIDER_ID ?? "local";
const POLL_MS = Number(process.env.RENDER_POLL_SECONDS ?? 10) * 1000;

if (!APP_URL || !SECRET) {
  console.error("Set RENDER_APP_URL and RENDER_WORKER_SECRET.");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${SECRET}`,
  "x-render-worker-id": WORKER_ID,
  "content-type": "application/json",
};

/** Run a command to completion, resolving its stdout. Rejects with the tail of
 *  stderr, because ffmpeg's actual complaint is always in the last few lines
 *  and the preceding hundred are banner. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`${command} exited ${code}: ${err.trim().split("\n").slice(-4).join(" ")}`));
    });
  });
}

async function report(jobId, body) {
  const response = await fetch(`${APP_URL}/api/renders/${jobId}/report`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  // A refused report is worth SAYING rather than swallowing: it means this
  // worker no longer holds the job (a restart, or a second instance), and the
  // render it is doing is going nowhere.
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn(`[report ${body.type}] ${response.status} ${detail}`);
  }
  return response.ok;
}

async function claim() {
  const response = await fetch(`${APP_URL}/api/renders/claim`, {
    method: "POST",
    headers,
    body: JSON.stringify({ providerId: PROVIDER_ID }),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`claim failed: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Whether a source carries an audio stream. ffmpeg has no way to express
 *  "use the real audio if there is any", so this decides it — see
 *  segmentArgs. A probe that fails is treated as NO audio, which is the safe
 *  direction: a silent track is a missing sound, a missing stream breaks the
 *  concat for every segment after it. */
async function probeHasAudio(path) {
  try {
    return (await run("ffprobe", probeAudioArgs(path))).includes("audio");
  } catch {
    return false;
  }
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function uploadResult(jobId, filePath) {
  const ticketResponse = await fetch(`${APP_URL}/api/renders/${jobId}/upload-ticket`, {
    method: "POST",
    headers,
  });
  if (!ticketResponse.ok) {
    throw new Error(`upload ticket refused: ${ticketResponse.status}`);
  }
  const ticket = await ticketResponse.json();

  // STRAIGHT TO CLOUDINARY, not through the app: a serverless request body is
  // capped at 4.5MB and a render is not. The signature came from the app, so
  // the app still decided where this lands.
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.fields)) form.append(key, value);
  form.append("file", new Blob([await readFile(filePath)]), `${jobId}.mp4`);

  const upload = await fetch(ticket.uploadUrl, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
  const result = await upload.json();
  if (!result.secure_url) throw new Error("upload returned no URL");
  return result.secure_url;
}

async function renderJob(job) {
  const workDir = await mkdtemp(join(tmpdir(), `render-${job.id}-`));
  try {
    await report(job.id, { type: "start" });
    const { cuts, layers = [], format } = job.cutList;
    // Both kinds normalise the same way, so one loop makes both. Only what
    // happens AFTER differs: the picture concatenates, the layers get mixed
    // underneath it.
    const total = cuts.length + layers.length;
    let done = 0;

    // `at` is the size to ENCODE this segment at, defaulting to the output
    // format. A framed layer overrides it with the inset's own pixel size:
    // segmentArgs fits-and-pads every source to whatever it is given, so a
    // layer normalised at full frame carries letterbox bars, and scaling that
    // down in the overlay would composite the bars along with the picture.
    // Encoding it small also means the overlay needs no scale filter at all.
    const normalise = async (cut, name, at = format) => {
      // Downloaded rather than streamed: a 404 or an expired URL then fails
      // here, clearly, instead of surfacing as an opaque ffmpeg error four
      // steps later.
      const sourcePath = join(workDir, `src-${name}${extensionFor(cut)}`);
      await download(cut.src, sourcePath);
      const hasAudio = cut.kind === "video" ? await probeHasAudio(sourcePath) : false;
      const segmentPath = join(workDir, `seg-${name}.mp4`);
      await run("ffmpeg", segmentArgs({ ...cut, src: sourcePath }, at, segmentPath, { hasAudio }));
      await report(job.id, {
        type: "progress",
        fraction: segmentFraction(done, total),
        message: `${done + 1} of ${total}`,
      });
      done += 1;
      return segmentPath;
    };

    const segments = [];
    for (const [index, cut] of cuts.entries()) {
      segments.push(await normalise(cut, `pic-${String(index).padStart(4, "0")}`));
    }

    const listPath = join(workDir, "concat.txt");
    await writeFile(listPath, concatListFile(segments));
    const picturePath = join(workDir, `picture-${job.id}.mp4`);
    await run("ffmpeg", concatArgs(listPath, picturePath));

    // THE LAYERS. Each is normalised like a cut — so a trimmed or rate-scaled
    // VO is resolved exactly the way a shot would be — and only its audio is
    // used by the mix.
    const layerSegments = [];
    for (const [index, layer] of layers.entries()) {
      // A rectangle means this one is COMPOSITED, not merely mixed. Resolved
      // once here, so the size it is encoded at and the position it is drawn
      // at cannot disagree.
      const rect =
        layer.layerFrame === undefined
          ? undefined
          : layerRectPixels(layer.layerFrame, layer.aspect ?? 16 / 9, format);
      layerSegments.push({
        path: await normalise(
          layer,
          `lay-${String(index).padStart(4, "0")}`,
          rect === undefined ? format : { ...format, width: rect.width, height: rect.height },
        ),
        outputStart: layer.outputStart,
        outputDuration: layer.outputDuration,
        ...(rect === undefined ? {} : { rect, trackIndex: layer.trackIndex ?? 1 }),
      });
    }

    const mix = mixArgs(picturePath, layerSegments, join(workDir, `${job.id}.mp4`));
    // Null means nothing to mix: the concat already IS the finished file, and
    // re-encoding to add nothing would cost a generation of the whole film.
    const outputPath = mix === null ? picturePath : join(workDir, `${job.id}.mp4`);
    if (mix !== null) {
      // SAY SO BEFORE STARTING. Segment progress caps at 0.95 and neither the
      // concat nor the mix reported anything, which was tolerable while the
      // mix was an audio remux over a copied video. Compositing makes it a
      // full re-encode of the finished film — comfortably the longest step of
      // the job — and a bar that sits still for minutes with no message is how
      // a working render gets killed for looking hung.
      const compositing = layerSegments.some((layer) => layer.rect !== undefined);
      await report(job.id, {
        type: "progress",
        fraction: segmentFraction(total, total),
        message: compositing ? "compositing layers" : "mixing audio",
      });
      await run("ffmpeg", mix);
    }

    const url = await uploadResult(job.id, outputPath);
    await report(job.id, { type: "succeed", outputUrl: url });
    console.log(`rendered ${job.id} -> ${url}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`render ${job.id} failed:`, message);
    await report(job.id, { type: "fail", message });
  } finally {
    // Renders are large and temporary. Left behind, a few of them fill a disk
    // and the failure lands on something unrelated.
    await rm(workDir, { recursive: true, force: true });
  }
}

function extensionFor(cut) {
  if (cut.kind === "image") return ".img";
  if (cut.kind === "audio") return ".audio";
  return ".mp4";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`render worker ${WORKER_ID} -> ${APP_URL} (provider: ${PROVIDER_ID})`);
  for (;;) {
    try {
      const job = await claim();
      if (job === null) {
        await sleep(POLL_MS);
        continue;
      }
      console.log(`claimed ${job.id}: ${job.cutList.cuts.length} cuts`);
      await renderJob(job);
    } catch (error) {
      // A poll that fails is ordinary — the app redeploys, the network blips.
      // Log and keep going; the alternative is a worker that quietly stops.
      console.error("worker loop:", error instanceof Error ? error.message : error);
      await sleep(POLL_MS);
    }
  }
}

main();
