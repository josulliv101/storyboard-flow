#!/usr/bin/env node
// Repair stored clip aspects that were never measured.
//
// Until #417, every clip minted in this app was stamped `aspect: 16/9` — a
// hardcoded literal at both write paths, never a reading of the file. The
// upload routes now carry width/height through and `aspectFromDimensions`
// mints from them, but that only fixes clips minted AFTER the change. Every
// clip already stored still claims 1.7778 whatever its source actually is.
//
// It is not cosmetic. `aspect` is a DIVISOR:
//
//   - a lane clip's picture-in-picture inset derives its HEIGHT from it
//     (`layerFrameHeight`), so a wrong aspect is a wrong-shaped inset;
//   - the strip sizes a card from it (`getItemWidth`);
//   - it is what a human reads to answer "what shape is this shot", and it
//     answered that question wrongly here once already.
//
// Measured, not guessed: ffprobe reads the exact URL the player loads and
// reports the exact dimensions the player will see. No Cloudinary credentials,
// no public_id parsing, no transformation guessing — the src is the answer.
// Header-only, so a probe is one range request (~0.16s against Cloudinary).
//
//   npm run correct:aspects                          dry run, every project
//   npm run correct:aspects -- --project <id>        one subtree
//   npm run correct:aspects -- --offline             re-run the dry run, ZERO reads
//   npm run correct:aspects -- --apply               write it
//
// DRY RUN BY DEFAULT, and --apply is refused offline (see `refuseOfflineWrite`
// — deciding a write from a stale snapshot is the bug these scripts clean up
// after). The probe results are cached on disk, so the second dry run costs no
// network either.
//
// A LIVE RUN IS NOT FREE: `loadDocuments` reads the whole collection, ~350
// documents. Run it live once, then iterate with --offline. See the long note
// in audit-orphaned-timelines.mjs for what exhausting the read quota did.
//
// WHAT IT WILL NOT TOUCH, all three deliberately:
//
//   collections   their aspect is not a measurement of anything — a container
//                 has no source file. Deriving one from its children is a
//                 different question with a different right answer.
//   audio         nothing to measure; ffprobe finds no video stream. The
//                 default is as good as it gets, and the surface draws a
//                 stand-in rather than the clip anyway.
//   anything the probe could not read
//                 a 404, a timeout, a src that is not media. Leaving a clip
//                 alone is always safe; writing a number we did not measure is
//                 the thing this script exists to undo.

import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { FieldValue, getFirestore } from "firebase-admin/firestore";

import {
  COLLECTION,
  announceSnapshot,
  loadDocuments,
  refuseOfflineWrite,
  snapshotFlags,
  walkReachable,
} from "./timeline-snapshot.mjs";
// Every decision this makes about the user's stored data lives there, pure and
// covered by the app suite. This file is the plumbing: argv, ffprobe, batches.
import {
  aspectOf,
  classify,
  correctableClips,
  scopeFrom,
  updateForDocument,
} from "./aspect-correction.mjs";

const execFileAsync = promisify(execFile);

const apply = process.argv.includes("--apply");
const listAll = process.argv.includes("--list");
const projectIndex = process.argv.indexOf("--project");
const onlyProject = projectIndex === -1 ? null : process.argv[projectIndex + 1];
const { offline, snapshotPath } = snapshotFlags();

const PROBE_CACHE = ".aspect-probe-cache.json";
/** Probes run against a CDN, so a handful at once is the difference between
 *  seconds and minutes. Kept low deliberately: this is someone's media host,
 *  not a load target. */
const PROBE_CONCURRENCY = 6;

/**
 * The real dimensions of whatever is at this URL, or null.
 *
 * `-select_streams v:0` is what makes this work uniformly: a png has one video
 * stream of one frame, an mp4 has a real one, and an mp3 has none — so audio
 * falls out as null without the script having to know the kind in advance.
 */
async function probe(src) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        src,
      ],
      { timeout: 30_000 },
    );
    const [width, height] = stdout.trim().split(",").map(Number);
    const aspect = aspectOf(width, height);
    return aspect === undefined ? null : { width, height, aspect };
  } catch {
    return null;
  }
}

/** Every probe, keyed by src. Written back after each run so a re-run — the
 *  dry run you do before deciding to --apply — costs nothing. */
function loadProbeCache() {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(PROBE_CACHE, "utf8"))));
  } catch {
    return new Map();
  }
}

async function probeAll(sources, cache) {
  const pending = [...sources].filter((src) => !cache.has(src));
  if (pending.length > 0) {
    console.log(`Probing ${pending.length} source${pending.length === 1 ? "" : "s"}…`);
  }
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, pending.length) }, async () => {
      while (next < pending.length) {
        const src = pending[next++];
        cache.set(src, await probe(src));
        done += 1;
        if (done % 25 === 0) console.log(`  …${done}/${pending.length}`);
      }
    }),
  );
  try {
    writeFileSync(PROBE_CACHE, JSON.stringify(Object.fromEntries(cache)));
  } catch (error) {
    console.error(`(could not write ${PROBE_CACHE}: ${error.message})`);
  }
}

async function main() {
  if (refuseOfflineWrite({ offline, apply, script: "correct:aspects" })) return;

  const loaded = await loadDocuments({ offline, snapshotPath });
  if (loaded === null) return;
  const { documents } = loaded;
  announceSnapshot(loaded);

  const scope = onlyProject === null ? null : scopeFrom(documents, onlyProject);
  if (onlyProject !== null && scope === null) {
    console.error(`No document ${onlyProject} in the collection.`);
    process.exitCode = 2;
    return;
  }
  if (scope === null) {
    // Unreachable documents are excluded on purpose: they are the audit
    // script's problem, and repairing a clip nothing can reach spends a write
    // to improve a document that is already lost.
    const { reachable } = walkReachable(documents);
    console.log(`${reachable.size} reachable documents.`);
  } else {
    console.log(`Scoped to ${onlyProject}: ${scope.size} documents in its subtree.`);
  }

  const clips = correctableClips(documents, scope);
  if (clips.length === 0) {
    console.log("No media clips in scope.");
    return;
  }

  const missingField = clips.filter((clip) => clip.stored === undefined).length;
  if (missingField === clips.length && !loaded.live) {
    console.error("This snapshot predates the aspect field — it cannot answer this.");
    console.error("Run it live once (without --offline) to take a fresh one.");
    process.exitCode = 2;
    return;
  }

  const cache = loadProbeCache();
  await probeAll(new Set(clips.map((clip) => clip.src)), cache);

  const { wrong, alreadyRight, unreadable } = classify(clips, cache);

  console.log("");
  console.log(
    `${clips.length} media clips: ${wrong.length} wrong, ${alreadyRight.length} already right, ${unreadable.length} unreadable.`,
  );

  if (wrong.length > 0) {
    console.log("");
    const shown = listAll ? wrong : wrong.slice(0, 25);
    for (const clip of shown) {
      const from = typeof clip.stored === "number" ? clip.stored.toFixed(3) : String(clip.stored);
      const { width, height, aspect } = clip.measured;
      console.log(
        `  ${from} → ${aspect.toFixed(3)}  (${width}x${height})  ${clip.title} / ${clip.alt || clip.clipId}`,
      );
    }
    if (shown.length < wrong.length) {
      console.log(`  … and ${wrong.length - shown.length} more (--list for all)`);
    }
  }

  if (unreadable.length > 0) {
    console.log("");
    console.log(`${unreadable.length} left alone — audio, or a source ffprobe could not read.`);
  }

  if (!apply) {
    console.log("");
    console.log(wrong.length === 0 ? "Nothing to do." : "DRY RUN. Re-run with --apply to write.");
    return;
  }
  if (wrong.length === 0) return;

  await write(wrong, documents);
}

/**
 * Write the measured aspects back.
 *
 * One `set(..., {merge: true})` per document, carrying both clip copies and a
 * BUMPED REVISION. The bump is the point: the gateway sends the revision it
 * read as `expectedRevision`, so a tab still holding the pre-correction
 * document now hits a conflict instead of quietly saving its cached 16:9 back
 * over the fix. Losing the correction to an open tab would be the likeliest
 * way for this to appear not to have worked.
 *
 * Batched in 400s — Firestore's limit is 500 writes, and this is one per
 * document.
 */
async function write(wrong, documents) {
  // No `initializeApp` here: `loadDocuments` did it, and --apply cannot reach
  // this without having gone live. A second call throws "already exists".
  const db = getFirestore();

  const byDocument = new Map();
  for (const clip of wrong) {
    if (!byDocument.has(clip.documentId)) byDocument.set(clip.documentId, []);
    byDocument.get(clip.documentId).push(clip);
  }

  let batch = db.batch();
  let queued = 0;
  let written = 0;
  let skipped = 0;
  let touchedDocuments = 0;

  for (const [documentId, clips] of byDocument) {
    const data = documents.get(documentId);
    const { update, skipped: missed, applied } = updateForDocument(data, clips);
    skipped += missed.length;
    if (update === null) continue;

    batch.set(
      db.collection(COLLECTION).doc(documentId),
      {
        ...update,
        revision: (typeof data?.revision === "number" ? data.revision : 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    written += applied;
    touchedDocuments += 1;
    queued += 1;
    if (queued === 400) {
      await batch.commit();
      batch = db.batch();
      queued = 0;
    }
  }

  if (queued > 0) await batch.commit();
  console.log("");
  console.log(`Wrote ${written} clip aspects across ${touchedDocuments} documents.`);
  if (skipped > 0) {
    console.log(`${skipped} skipped — the clip at that index is no longer the one measured.`);
  }
  console.log("Reload any open tab: it is holding the old values, and its next");
  console.log("save will now be refused as a revision conflict until it does.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
