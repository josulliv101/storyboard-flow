#!/usr/bin/env node
// Delete the EMPTY unreachable documents that `audit:orphans` reports.
//
// The audit found 139 unreachable documents. Most are not work: they are empty
// shells left behind by a "new collection" button pressed and abandoned, over
// months, made permanent by an Empty Trash that never deleted anything and a
// reachability rule nothing enforced. Reviewing 139 by hand to find the ten
// that matter is the reason nobody ever cleans this up, so this removes the
// obviously-nothing and leaves a list a person can actually read.
//
//   npm run prune:orphans                  # dry run
//   npm run prune:orphans -- --apply       # delete (note the bare -- separator)
//   PRUNE_APPLY=1 npm run prune:orphans    # delete, in a form npm cannot swallow
//
// `npm run prune:orphans --apply` WITHOUT the separator is discarded by npm
// before the script runs — see scripts/apply-flag.mjs.
//
// SAFETY, and this is the whole design:
//
//   ZERO CLIPS ONLY. A document holding anything at all — one media clip, one
//   sub-collection — is never touched, whatever it is called. "New Collection"
//   with eight clips in it is still eight clips of somebody's work, and a bulk
//   pass that eats those is worse than a long review list. Naming is used only
//   to narrow an already-empty set, never to justify deleting content.
//
//   REACHABLE DOCUMENTS ARE NEVER TOUCHED. The walk is the same one
//   `audit-orphaned-timelines.mjs` does, including the trash bin as a root, so
//   anything sitting in the bin is out of scope by construction.
//
//   ASSET LIBRARIES ARE SKIPPED. They are addressed directly rather than
//   through a project tree, so the walk cannot see them and they are not
//   orphans.
//
// It is a hard delete, not a move to the trash. These documents hold nothing,
// so there is nothing to recover; putting 87 empty shells in the bin would just
// move the mess. Anything with content goes to review instead — see the list
// this prints under KEEPING.

import { cert, applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { dryRunNotice, readApplyFlag } from "./apply-flag.mjs";

// Must track TIMELINE_COLLECTION in lib/firebase-timeline-store.ts.
const COLLECTION = "gstudioTimelineDocuments";
const apply = readApplyFlag("prune:orphans", "PRUNE_APPLY");

/** Titles that mean "made by a button, never used". Only ever consulted for a
 *  document already proven to hold nothing. */
const SCRATCH_TITLE = /^(new collection|new timeline|untitled|\(untitled\))$/i;

function credential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return { credential: cert({ projectId, clientEmail, privateKey }), projectId };
  }
  return { credential: applicationDefault(), projectId };
}

function clipsOf(data) {
  if (Array.isArray(data?.document?.clips)) return data.document.clips;
  if (Array.isArray(data?.clips)) return data.clips;
  return [];
}

function childIdsOf(data) {
  return clipsOf(data)
    .filter((clip) => clip?.kind === "collection" && typeof clip.childTimelineId === "string")
    .map((clip) => clip.childTimelineId);
}

async function main() {
  initializeApp(credential());
  const db = getFirestore();

  const snapshot = await db.collection(COLLECTION).get();
  const documents = new Map();
  snapshot.forEach((doc) => documents.set(doc.id, doc.data()));

  const reachable = new Set();
  const queue = [...documents.entries()]
    .filter(([id, data]) => data?.isProject === true || id.startsWith("trash-"))
    .map(([id]) => id);
  while (queue.length > 0) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const childId of childIdsOf(documents.get(id))) {
      if (!reachable.has(childId)) queue.push(childId);
    }
  }

  const deletable = [];
  const keeping = [];
  for (const [id, data] of documents) {
    if (reachable.has(id)) continue;
    if (id.startsWith("asset-library")) continue;
    const clips = clipsOf(data);
    const title = String(data?.title ?? "(untitled)").trim();
    const media = clips.filter((clip) => clip?.kind !== "collection").length;
    const row = { id, title, clips: clips.length, media, subs: childIdsOf(data).length };
    // The rule: empty AND named like scratch. Either alone is not enough.
    if (clips.length === 0 && SCRATCH_TITLE.test(title)) deletable.push(row);
    else keeping.push(row);
  }
  keeping.sort((a, b) => b.media - a.media || b.clips - a.clips);

  console.log(`collection:   ${COLLECTION}`);
  console.log(`documents:    ${documents.size}`);
  console.log(`unreachable:  ${deletable.length + keeping.length}`);
  console.log(`  deletable (empty + scratch name): ${deletable.length}`);
  console.log(`  KEEPING for review:               ${keeping.length}`);
  console.log("");

  if (keeping.length > 0) {
    console.log("KEEPING — unreachable but holding something. Not this script's job:");
    for (const row of keeping) {
      console.log(
        `  ${row.id.padEnd(32)} ${String(row.clips).padStart(3)}c ` +
          `${String(row.media).padStart(3)}m ${String(row.subs).padStart(2)}s  ${row.title}`,
      );
    }
    console.log("");
  }

  if (deletable.length === 0) {
    console.log("Nothing to prune.");
    return;
  }

  const byTitle = new Map();
  for (const row of deletable) byTitle.set(row.title, (byTitle.get(row.title) ?? 0) + 1);
  console.log(`${apply ? "Deleting" : "Would delete"} ${deletable.length} empty document(s):`);
  for (const [title, count] of [...byTitle].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${title}`);
  }
  console.log("");

  if (!apply) {
    console.log(dryRunNotice("prune:orphans", "PRUNE_APPLY"));
    return;
  }

  // Firestore caps a batch at 500 writes; chunk well under it.
  const CHUNK = 200;
  let deleted = 0;
  for (let index = 0; index < deletable.length; index += CHUNK) {
    const slice = deletable.slice(index, index + CHUNK);
    const batch = db.batch();
    for (const row of slice) batch.delete(db.collection(COLLECTION).doc(row.id));
    await batch.commit();
    deleted += slice.length;
  }
  console.log(`Deleted ${deleted} document(s). Re-run audit:orphans to confirm the new total.`);
}

main().catch((error) => {
  console.error("Prune failed:", error.message);
  process.exitCode = 2;
});
