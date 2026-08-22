#!/usr/bin/env node
// WHICH CLIPS POINT AT FILES THAT ARE NO LONGER THERE.
//
// A sweep of the Cloudinary account answers the opposite question — every
// asset IN it delivers — and cannot see a reference FROM a timeline to
// something that has since been deleted. That direction is the one that shows
// up as a broken picture in the app, so it is the one worth checking.
//
// READ ONLY. It never writes, claims, or deletes.
//
//   npm run audit:assets --workspace=apps/timeline-gstudio001
//   npm run audit:assets --workspace=apps/timeline-gstudio001 -- --limit 200
//
// CHEAP BY DESIGN, because a full-collection scan is what exhausted the read
// quota once before:
//
//   - it COUNTS first and prints the number, so the cost is known before the
//     scan rather than discovered afterwards;
//   - it `select()`s the clip field alone, so nothing else crosses the wire;
//   - every distinct URL is probed ONCE however many clips share it, with
//     HEAD rather than GET — a broken reference costs no delivery bandwidth,
//     which matters when the account is near its credit ceiling;
//   - `--limit` caps the documents read, for a look around before committing
//     to the whole collection.
//
// The probe is deliberately the URL the app would actually load rather than a
// public_id derived from it. A reference can be dead for reasons that have
// nothing to do with the asset existing — a malformed transform, a stale
// cloud name, an unencoded space — and those fail in the browser exactly the
// same way. Asking the URL asks the real question.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";

// Enough to finish in reasonable time, few enough that a CDN never sees this
// as a burst worth throttling.
const PROBE_CONCURRENCY = 10;

const limitFlagIndex = process.argv.indexOf("--limit");
const limit =
  limitFlagIndex === -1 ? null : Number.parseInt(process.argv[limitFlagIndex + 1] ?? "", 10);

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

/** Every asset URL a clip renders from, `poster` included: a clip whose video
 *  survives but whose poster does not is still a hole in the board. */
function urlsOf(clip) {
  const found = [];
  if (typeof clip?.src === "string" && clip.src.startsWith("http")) found.push(clip.src);
  if (typeof clip?.poster === "string" && clip.poster.startsWith("http")) found.push(clip.poster);
  return found;
}

async function probe(url) {
  try {
    // HEAD: this asks whether the file is there, and a dead reference should
    // not cost a download to discover — least of all on an account near its
    // ceiling.
    //
    // NOT `encodeURI`. A stored public_id may contain a space ("Foobar 001")
    // and the URL that was saved already carries it as `%20` — running that
    // through `encodeURI` escapes the PERCENT, giving `%2520`, which is a
    // different path and 404s. Every asset in the account then reports dead,
    // which is a very convincing way to be wrong. Only a LITERAL space needs
    // encoding, and only because a bare space is not a URL at all.
    const safe = url.replace(/ /g, "%20");
    const response = await fetch(safe, { method: "HEAD", redirect: "follow" });
    // 405 IS THE HOST REFUSING THE QUESTION, not an answer to it. Some hosts
    // serve GET and reject HEAD — the placeholder service the dev fixtures use
    // is one — and reporting those as dead would bury the real findings in
    // noise that is not even about this project's assets. Asked again with a
    // one-byte range, which costs no more than the HEAD would have.
    if (response.status !== 405) return response.status;
    const ranged = await fetch(safe, {
      method: "GET",
      redirect: "follow",
      headers: { Range: "bytes=0-0" },
    });
    return ranged.status;
  } catch (error) {
    // A network failure is not a 404 and must not be reported as one.
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function main() {
  const { credential: creds, projectId } = credential();
  initializeApp({ credential: creds, projectId });
  const db = getFirestore();

  const collection = db.collection(COLLECTION);
  const total = (await collection.count().get()).data().count;
  const reading = limit === null ? total : Math.min(limit, total);
  console.log(`${COLLECTION}: ${total} documents, reading ${reading}`);

  const query = limit === null ? collection.select("clips") : collection.select("clips").limit(limit);
  const snapshot = await query.get();

  // Distinct URL -> the clips that reference it, so a dead one can be named
  // rather than merely counted.
  const references = new Map();
  let clipCount = 0;
  for (const doc of snapshot.docs) {
    for (const clip of doc.get("clips") ?? []) {
      clipCount += 1;
      for (const url of urlsOf(clip)) {
        const where = references.get(url) ?? [];
        where.push(`${doc.id}/${clip.id ?? "?"}`);
        references.set(url, where);
      }
    }
  }
  console.log(
    `${clipCount} clips, ${references.size} distinct asset URLs (${
      clipCount - references.size
    } shared or duplicated)`,
  );

  const urls = [...references.keys()];
  const dead = [];
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, urls.length) }, async () => {
      while (urls.length > 0) {
        const url = urls.pop();
        const status = await probe(url);
        done += 1;
        // ANY 2xx IS ALIVE. The ranged retry above answers 206 (Partial
        // Content), which is a success — testing for exactly 200 would report
        // every host that refuses HEAD as dead by a different route than the
        // one just fixed.
        const alive = typeof status === "number" && status >= 200 && status < 300;
        if (!alive) dead.push({ url, status, clips: references.get(url) });
        if (done % 50 === 0) console.log(`  probed ${done}...`);
      }
    }),
  );

  console.log(`\n=== ${dead.length} dead of ${references.size} ===`);
  const byStatus = new Map();
  for (const entry of dead) {
    byStatus.set(entry.status, (byStatus.get(entry.status) ?? 0) + 1);
  }
  for (const [status, count] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }
  for (const entry of dead.slice(0, 40)) {
    console.log(`\n${entry.status}  ${entry.url}`);
    console.log(`  referenced by ${entry.clips.length}: ${entry.clips.slice(0, 5).join(", ")}`);
  }
  if (dead.length > 40) console.log(`\n...and ${dead.length - 40} more`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
