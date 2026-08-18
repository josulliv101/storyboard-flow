// Write real video durations into the stored documents, ONCE, so nothing has
// to repair them on every read.
//
//   npm run migrate:durations --workspace=apps/timeline-gstudio001            # dry run
//   npm run migrate:durations --workspace=apps/timeline-gstudio001 -- --apply # write
//
// WHY IT EXISTS. Before the Cloudinary Search API was wired up, the asset
// listing carried no durations, so every dropped video was stored with a flat
// default (6s or 8s). `healTimelineDocument` corrected that AT READ TIME — on
// every board open, forever, behind a listing call measured at 1844ms of an
// 1887ms serve. That correction is a one-time migration; it was a runtime
// feature only by accident.
//
// A clip already stores everything needed to render it: `sourceDuration`,
// `trimIn`, `trimOut`, `duration`, `src`, `poster`, and `sourceAsset` for
// provenance. Nothing about drawing a timeline needs a third party at read
// time. This fills the one field history left wrong, after which the heal has
// nothing to do and is deleted.
//
// TRIMMED CLIPS ARE NEVER TOUCHED. A stored trim is a user's choice, and
// rewriting `sourceDuration` under it breaks the invariant
// `trimIn + duration + trimOut === sourceDuration`. Only untrimmed clips are
// eligible — exactly the rule the heal applied.
//
// NO REPACKING HERE, deliberately. A duration change does move every later
// clip — but `startTime` is DERIVED on load, not read from storage: the domain
// adapter "projects a collection's children back to TimelineClip[] with derived
// startTime/index (packing math identical to packTimelineClips)". Writing the
// duration is therefore the whole job, and re-deriving positions in a script
// would mean a second implementation of packing that could disagree with the
// app's — the exact drift the adapter's own comment warns about.
import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";
import {
  COLLECTION,
  announceSnapshot,
  loadDocuments,
  refuseOfflineWrite,
  snapshotFlags,
} from "./timeline-snapshot.mjs";

const apply = readApplyFlag("migrate:durations", "MIGRATE_DURATIONS_APPLY");
const { offline, snapshotPath } = snapshotFlags();

/** The same epsilon the heal used, so this migrates exactly what it repaired. */
const DURATION_EPSILON = 0.05;
/** Firestore's hard ceiling on operations in one batched write. */
const MAX_BATCH_OPS = 500;

/** `CLOUDINARY_URL` is `cloudinary://key:secret@cloud`. */
function cloudinaryConfig() {
  const raw = process.env.CLOUDINARY_URL;
  if (!raw) throw new Error("CLOUDINARY_URL is required to read true durations.");
  const parsed = new URL(raw);
  return {
    cloudName: parsed.hostname,
    apiKey: decodeURIComponent(parsed.username),
    apiSecret: decodeURIComponent(parsed.password),
    folder: process.env.CLOUDINARY_FOLDER || "timeline-gstudio001",
  };
}

/**
 * Every video's true duration, keyed by public_id.
 *
 * THE SEARCH API, not the Admin list. The Admin list does not carry `duration`
 * at all — the app's own store calls it "the duration-less Admin list" and only
 * degrades to it when Search is unavailable. Reaching for it here returned 0
 * durations and a dry run that cheerfully reported nothing to do.
 *
 * ONE paginated pass for the whole migration, rather than one per board open
 * for the life of the app, which is the entire point of doing this once.
 */
async function loadDurations(config) {
  const durations = new Map();
  let cursor;
  let pages = 0;
  do {
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/resources/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expression: `public_id:${config.folder}/* AND resource_type:video`,
          max_results: 100,
          ...(cursor ? { next_cursor: cursor } : {}),
        }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      throw new Error(body?.error?.message ?? `Cloudinary search failed with ${response.status}.`);
    }
    for (const resource of body.resources ?? []) {
      if (typeof resource.duration === "number" && resource.duration > 0) {
        durations.set(resource.public_id, resource.duration);
      }
    }
    cursor = body.next_cursor;
    pages += 1;
  } while (cursor && pages < 50);
  return durations;
}

/** The stored clips, from whichever field carries them — same rule as the
 *  other scripts, since a record written by an older path has only `clips`. */
const clipsOf = (data) => data?.document?.clips ?? data?.clips ?? [];

/**
 * PROVENANCE ONLY. A clip records the asset it was placed from
 * (`sourceAsset.assetId` IS the public_id), which is an exact identity match.
 *
 * The heal also had a filename fallback for clips predating provenance, and
 * that fallback is deliberately NOT carried here: its own history is that two
 * assets sharing a filename in different projects collapsed onto one key and
 * the wrong one won — and because the result was persisted then, a plain read
 * could repoint a clip at another project's file. A migration writes to disk
 * permanently, which is the worst possible place to guess.
 */
function trueDurationFor(clip, durations) {
  const assetId = clip?.sourceAsset?.assetId;
  if (typeof assetId !== "string") return undefined;
  return durations.get(assetId);
}

/**
 * Every document, with every field.
 *
 * `--offline` reads the fixture dump instead, which is a full copy and costs
 * NOTHING — the live path is a full-collection read (~350 documents here), and
 * this script should be developed against the free one and run against the real
 * one once. See the quota note in timeline-snapshot.mjs.
 */
async function loadRawDocuments() {
  if (offline) {
    const { readFileSync } = await import("node:fs");
    const path = snapshotPath && snapshotPath !== ".orphan-snapshot.json"
      ? snapshotPath
      : "fixtures/local.json";
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    console.log(`offline: ${path}`);
    return new Map(Object.entries(parsed.documents ?? {}));
  }
  // Its own bootstrap: this script reads RAW documents rather than going
  // through `loadDocuments`, which is what used to initialize the app.
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  initializeApp(
    clientEmail && privateKey
      ? { credential: cert({ projectId, clientEmail, privateKey }), projectId }
      : { credential: applicationDefault(), projectId },
  );
  const snapshot = await getFirestore().collection(COLLECTION).get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

async function main() {
  if (refuseOfflineWrite({ offline, apply, script: "migrate:durations" })) return;

  // RAW DOCUMENTS, not the shared snapshot. `toSnapshotEntry` keeps title,
  // ownerUid, isProject and a reduced clip shape — and drops `sourceAsset`,
  // `trimIn`, `trimOut` and `sourceDuration`, which is everything this script
  // reasons about. Reading through it reported 136 clips "without provenance"
  // against a real count of 9.
  const documents = await loadRawDocuments();
  console.log(`${documents.size} documents.`);

  const durations = await loadDurations(cloudinaryConfig());
  console.log(`${durations.size} videos with a true duration from Cloudinary.`);

  const pending = [];
  let trimmedSkipped = 0;
  let noProvenance = 0;

  for (const [id, data] of documents) {
    const clips = clipsOf(data);
    let touched = false;
    const next = clips.map((clip) => {
      if (clip?.kind !== "video") return clip;
      if ((clip.trimIn ?? 0) !== 0 || (clip.trimOut ?? 0) !== 0) {
        trimmedSkipped += 1;
        return clip;
      }
      const real = trueDurationFor(clip, durations);
      if (real === undefined) {
        noProvenance += 1;
        return clip;
      }
      if (Math.abs((clip.sourceDuration ?? clip.duration ?? 0) - real) <= DURATION_EPSILON) {
        return clip;
      }
      touched = true;
      return { ...clip, duration: real, sourceDuration: real };
    });
    if (touched) pending.push({ id, clips: next });
  }

  console.log(
    `${pending.length} document(s) to rewrite · ` +
      `${trimmedSkipped} trimmed clip(s) left alone · ` +
      `${noProvenance} clip(s) without provenance (not guessed at)`,
  );
  for (const entry of pending.slice(0, 20)) {
    console.log(`  ${entry.id}`);
  }
  if (pending.length > 20) console.log(`  … and ${pending.length - 20} more`);

  if (!apply) {
    dryRunNotice("migrate:durations");
    return;
  }

  const db = getFirestore();
  let written = 0;
  for (let at = 0; at < pending.length; at += MAX_BATCH_OPS) {
    const chunk = pending.slice(at, at + MAX_BATCH_OPS);
    const batch = db.batch();
    for (const entry of chunk) {
      // MERGE, and both places clips live: `document.clips` is what the app
      // reads and `clips` is the denormalized copy, and leaving them
      // disagreeing is how a document reads differently depending on which
      // path loaded it.
      batch.set(
        db.collection(COLLECTION).doc(entry.id),
        { clips: entry.clips, document: { clips: entry.clips } },
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  committed ${written}/${pending.length}`);
  }
  console.log(`Rewrote ${written} document(s).`);
}

await main();
