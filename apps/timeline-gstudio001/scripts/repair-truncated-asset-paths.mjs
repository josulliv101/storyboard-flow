#!/usr/bin/env node
// RE-POINT CLIPS WHOSE ASSET URL LOST ITS FOLDER.
//
// `audit:assets` found eleven references that 404, all the same shape: the
// public_id is missing the `<uid>/<collection>` segments that the file is
// actually filed under. The asset was never deleted — the URL names a folder
// it was never in:
//
//   stored  .../timeline-gstudio001/SCAIL2_00019_-1782571572404.mp4
//   actual  .../timeline-gstudio001/<uid>/Foobar 001/SCAIL2_00019_-…mp4
//
// This rewrites the stored url to the one that resolves, and nothing else.
//
//   npm run repair:asset-paths --workspace=apps/timeline-gstudio001
//   npm run repair:asset-paths --workspace=apps/timeline-gstudio001 -- --apply
//
// DRY BY DEFAULT. Without `--apply` it prints every change it would make and
// writes nothing.
//
// THREE THINGS IT REFUSES TO DO, because this edits stored work:
//
//   - it will not guess. The mapping is filename -> public_id built from the
//     Cloudinary account itself, and if any filename maps to more than one
//     asset the whole run stops rather than picking one;
//   - it will not write a url it has not PROVED resolves. Every replacement is
//     fetched first, and one that does not answer 2xx is skipped and reported,
//     so a repair can never make a live reference dead;
//   - it will not clobber a concurrent edit. Each document is read and written
//     inside a transaction, and only the two string fields change — the clip's
//     id, timing, trim and everything else are carried through untouched.
//
// Every original is written to `repair-truncated-asset-paths.backup.json`
// before the first write, so the change can be reversed by hand.

import { writeFileSync } from "node:fs";

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = "gstudioTimelineDocuments";
const BACKUP_PATH = "repair-truncated-asset-paths.backup.json";
const apply = process.argv.includes("--apply");

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

function cloudinary() {
  const url = process.env.CLOUDINARY_URL ?? "";
  const rest = url.replace("cloudinary://", "");
  const [creds, cloud] = [rest.slice(0, rest.lastIndexOf("@")), rest.slice(rest.lastIndexOf("@") + 1)];
  if (!creds || !cloud) throw new Error("CLOUDINARY_URL is not set or not parseable");
  return { auth: "Basic " + Buffer.from(creds).toString("base64"), cloud };
}

/** Every asset in the account, as filename -> full public_id. Built from the
 *  Admin API rather than guessed from the url, because the whole failure being
 *  repaired is a url that does not say where its file lives. */
async function assetsByFilename({ auth, cloud }) {
  const byName = new Map();
  const ambiguous = new Set();
  for (const type of ["image", "video"]) {
    let cursor = "";
    do {
      const query = new URLSearchParams({ max_results: "500" });
      if (cursor) query.set("next_cursor", cursor);
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud}/resources/${type}?${query}`,
        { headers: { Authorization: auth } },
      );
      if (!response.ok) throw new Error(`Cloudinary ${type} list: ${response.status}`);
      const body = await response.json();
      for (const resource of body.resources ?? []) {
        const name = resource.public_id.slice(resource.public_id.lastIndexOf("/") + 1);
        if (byName.has(name) && byName.get(name).publicId !== resource.public_id) {
          ambiguous.add(name);
        }
        byName.set(name, { publicId: resource.public_id, type, format: resource.format });
      }
      cursor = body.next_cursor ?? "";
    } while (cursor);
  }
  return { byName, ambiguous };
}

const encodePath = (publicId) => publicId.split("/").map(encodeURIComponent).join("/");

/**
 * The repaired url, or null when this one needs no repair and cannot be
 * mapped.
 *
 * Only the PUBLIC_ID part is replaced. Everything else in the url — the
 * resource type, the transform chain, the version — is left exactly as stored,
 * because a poster carries `so_0.35,w_640,h_360,c_fill,q_auto,f_jpg` and that
 * is what makes it a poster rather than a video.
 */
function repaired(url, byName) {
  const match = /\/(image|video)\/upload\/(.*)$/.exec(url);
  if (match === null) return null;
  const tail = match[2];
  const lastSlash = tail.lastIndexOf("/");
  const file = lastSlash === -1 ? tail : tail.slice(lastSlash + 1);
  const dot = file.lastIndexOf(".");
  const stem = decodeURIComponent(dot === -1 ? file : file.slice(0, dot));
  const asset = byName.get(stem);
  if (asset === undefined) return null;
  // The stored public_id is a SUFFIX of the real one — same filename, fewer
  // folders — so swapping the whole trailing path for the real one is the
  // repair, and leaves any transform or version prefix in place.
  const storedPath = lastSlash === -1 ? file : tail.slice(0, lastSlash + 1) + file;
  const storedPublicId = storedPath.slice(storedPath.lastIndexOf("timeline-gstudio001/"));
  if (!storedPath.includes("timeline-gstudio001/")) return null;
  const extension = dot === -1 ? "" : file.slice(dot);
  return url.replace(storedPublicId, encodePath(asset.publicId) + extension);
}

async function resolves(url) {
  try {
    const response = await fetch(url.replace(/ /g, "%20"), { method: "HEAD", redirect: "follow" });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

async function main() {
  const { credential: creds, projectId } = credential();
  initializeApp({ credential: creds, projectId });
  const db = getFirestore();
  const { byName, ambiguous } = await assetsByFilename(cloudinary());

  if (ambiguous.size > 0) {
    // A filename that names two assets cannot be repaired by filename. Nothing
    // is written, because the alternative is picking one and being wrong in a
    // way nobody would notice until they opened the shot.
    console.error(`AMBIGUOUS filenames, refusing to guess: ${[...ambiguous].join(", ")}`);
    process.exit(1);
  }
  console.log(`${byName.size} assets in the account, every filename unique`);

  const snapshot = await db.collection(COLLECTION).select("clips").get();
  const plan = [];
  for (const doc of snapshot.docs) {
    for (const clip of doc.get("clips") ?? []) {
      for (const field of ["src", "poster"]) {
        const url = clip?.[field];
        if (typeof url !== "string" || !url.includes("res.cloudinary.com")) continue;
        if (await resolves(url)) continue;
        const fixed = repaired(url, byName);
        if (fixed === null) {
          console.log(`NO MAPPING  ${doc.id}/${clip.id} ${field}\n  ${url}`);
          continue;
        }
        if (!(await resolves(fixed))) {
          console.log(`WOULD NOT RESOLVE, skipping  ${doc.id}/${clip.id} ${field}\n  ${fixed}`);
          continue;
        }
        plan.push({ docId: doc.id, clipId: clip.id, field, from: url, to: fixed });
      }
    }
  }

  console.log(`\n=== ${plan.length} repairs ===`);
  for (const entry of plan) {
    console.log(`\n${entry.docId}/${entry.clipId} ${entry.field}`);
    console.log(`  - ${entry.from}`);
    console.log(`  + ${entry.to}`);
  }
  if (plan.length === 0) return;
  if (!apply) {
    console.log("\nDRY RUN. Nothing written. Re-run with --apply.");
    return;
  }

  writeFileSync(BACKUP_PATH, JSON.stringify(plan, null, 2));
  console.log(`\nOriginals saved to ${BACKUP_PATH}`);

  const byDoc = new Map();
  for (const entry of plan) {
    byDoc.set(entry.docId, [...(byDoc.get(entry.docId) ?? []), entry]);
  }
  for (const [docId, entries] of byDoc) {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTION).doc(docId);
      // RE-READ INSIDE THE TRANSACTION. The plan was built from a snapshot
      // taken minutes ago; the clips written back must be the ones that are
      // there now, or an edit made in between is silently reverted.
      const fresh = await tx.get(ref);
      const clips = fresh.get("clips") ?? [];
      const next = clips.map((clip) => {
        // FILTER, NOT FIND. A clip usually has TWO entries — its `src` and its
        // `poster` are separate urls and both are broken the same way — and
        // `find` returns the first, which repaired every video and left every
        // poster dead. The re-audit is what caught it; the first run reported
        // nineteen repairs and fixed eleven.
        const changes = entries.filter((entry) => entry.clipId === clip.id);
        if (changes.length === 0) return clip;
        let updated = clip;
        for (const change of changes) {
          // Only if it is still what the plan expects: anything else means it
          // moved under us and is not ours to overwrite.
          if (updated[change.field] !== change.from) continue;
          updated = { ...updated, [change.field]: change.to };
        }
        return updated;
      });
      tx.update(ref, { clips: next });
    });
    console.log(`repaired ${entries.length} in ${docId}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
